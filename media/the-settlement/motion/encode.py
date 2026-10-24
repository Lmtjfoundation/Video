"""Encodes the shot prompts with T5-XXL without storing the 19 GB fp32 encoder on disk: each tensor is fetched with an
HTTP range request straight from Hugging Face and kept in memory as bfloat16 (about 9.5 GB)."""
import json, struct, sys, urllib.request
import torch
from transformers import T5EncoderModel, T5Config, T5Tokenizer

M, OUT = sys.argv[1], sys.argv[2]
sys.path.insert(0, sys.argv[3])
from prompts import SHOTS, STYLE

BASE = "https://huggingface.co/Lightricks/LTX-Video-0.9.5/resolve/main/text_encoder/"
DT = {"F32": torch.float32, "F16": torch.float16, "BF16": torch.bfloat16}

def get(url, a, b):
    req = urllib.request.Request(url, headers={"Range": f"bytes={a}-{b - 1}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()

tok = T5Tokenizer.from_pretrained(f"{M}/tokenizer")  # first, so a tokenizer problem fails before the 19 GB fetch
state = {}
shards = sorted(set(json.load(open(f"{M}/text_encoder/model.safetensors.index.json"))["weight_map"].values()))
for sh in shards:
    url = BASE + sh
    n = struct.unpack("<Q", get(url, 0, 8))[0]
    head = json.loads(get(url, 8, 8 + n))
    head.pop("__metadata__", None)
    items = sorted(head.items(), key=lambda kv: kv[1]["data_offsets"][0])
    # Fetch in ~256 MB windows so there are few requests.
    i = 0
    while i < len(items):
        start = items[i][1]["data_offsets"][0]
        j = i
        while j < len(items) and items[j][1]["data_offsets"][1] - start < 256 << 20:
            j += 1
        j = max(j, i + 1)
        end = items[j - 1][1]["data_offsets"][1]
        buf = get(url, 8 + n + start, 8 + n + end)
        for name, meta in items[i:j]:
            a, b = meta["data_offsets"]
            t = torch.frombuffer(bytearray(buf[a - start:b - start]), dtype=DT[meta["dtype"]]).reshape(meta["shape"])
            state[name] = t.to(torch.bfloat16)
        del buf
        i = j
    print("loaded", sh, len(state), flush=True)

cfg = T5Config.from_pretrained(f"{M}/text_encoder")
with torch.device("meta"):
    model = T5EncoderModel(cfg)
model.load_state_dict(state, strict=False, assign=True)
model.tie_weights()
if model.encoder.embed_tokens.weight.is_meta:
    model.encoder.embed_tokens.weight = model.shared.weight
model.eval()
out = []
with torch.no_grad():
    for _, text in SHOTS:
        t = tok(text + STYLE, padding="max_length", max_length=128, truncation=True, add_special_tokens=True, return_tensors="pt")
        emb = model(t.input_ids, attention_mask=t.attention_mask)[0]
        assert torch.isfinite(emb.float()).all()
        out.append({"embeds": emb.to(torch.bfloat16), "mask": t.attention_mask})
torch.save(out, OUT)
print("saved", len(out), "prompt encodings")

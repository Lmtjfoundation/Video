"""Encodes the motion prompts with a T5-XXL v1.1 encoder (the one LTX-Video uses), loaded from a single
safetensors file (comfyanonymous/flux_text_encoders t5xxl_fp16), with LTX's tokenizer and encoder config.
Usage: embed.py LTX_DIR T5_FILE OUT [names]"""
import sys, os, torch
from safetensors.torch import load_file
from transformers import T5Config, T5EncoderModel, T5Tokenizer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import SHOTS, STYLE
M, T5, OUT = sys.argv[1:4]
names = sys.argv[4].split(",") if len(sys.argv) > 4 else list(SHOTS)
torch.set_num_threads(os.cpu_count())
tok = T5Tokenizer.from_pretrained(M, subfolder="tokenizer")
cfg = T5Config.from_pretrained(M, subfolder="text_encoder")
with torch.device("meta"):
    enc = T5EncoderModel(cfg)
sd = {k: v.to(torch.bfloat16) for k, v in load_file(T5).items()}
missing, unexpected = enc.load_state_dict(sd, strict=False, assign=True)
print("missing", missing, "unexpected", unexpected, flush=True)
enc.tie_weights() if "encoder.embed_tokens.weight" in missing else None
enc.eval()
res = torch.load(OUT) if os.path.exists(OUT) else {}
with torch.inference_mode():
    for k in names:
        t = tok(SHOTS[k] + STYLE, padding="max_length", max_length=128, truncation=True, add_special_tokens=True, return_tensors="pt")
        e = enc(t.input_ids, attention_mask=t.attention_mask)[0]
        res[k] = {"embeds": e.to(torch.bfloat16), "mask": t.attention_mask}
        print(k, e.shape, float(e.float().std()), flush=True)
torch.save(res, OUT)

"""Encodes the motion prompts with LTX-Video's T5 text encoder once, so the encoder can be deleted afterwards."""
import sys, os, torch
from transformers import T5EncoderModel, T5Tokenizer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import SHOTS, STYLE
M, OUT = sys.argv[1:3]
torch.set_num_threads(os.cpu_count())
tok = T5Tokenizer.from_pretrained(M, subfolder="tokenizer")
enc = T5EncoderModel.from_pretrained(M, subfolder="text_encoder", torch_dtype=torch.bfloat16).eval()
res = {}
with torch.inference_mode():
    for k, p in SHOTS.items():
        t = tok(p + STYLE, padding="max_length", max_length=128, truncation=True, add_special_tokens=True, return_tensors="pt")
        e = enc(t.input_ids, attention_mask=t.attention_mask)[0]
        res[k] = {"embeds": e.to(torch.bfloat16), "mask": t.attention_mask}
        print(k, e.shape, flush=True)
torch.save(res, OUT)

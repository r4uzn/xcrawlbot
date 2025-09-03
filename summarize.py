# summarize.py
import sys, json, os, torch
from transformers import AutoTokenizer, AutoModelForCausalLM

# 모델은 환경에 맞게 교체 가능
MODEL_ID = os.getenv("LLM_MODEL", "meta-llama/Meta-Llama-3-8B-Instruct")
HF_TOKEN = os.getenv("HUGGINGFACEHUB_API_TOKEN")

def load_json(path):
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)

def build_prompt(keyword, reactions, news=None):
  news = news or []
  tweets_block = "\n".join(f"- {t}" for t in reactions[:80])
  news_lines = []
  for n in news[:5]:
    news_lines.append(
      f'- {n.get("title","")} — {n.get("source","")} — {n.get("publishedAt","")}\n'
      f'  {n.get("snippet","")} ({n.get("url","")})'
    )
  news_block = "\n".join(news_lines)

  system = "당신은 실시간 이슈 요약 전문가입니다. 사실 확인과 균형을 중시합니다."
  user = f"""
아래 트윗 반응{('과 최근 뉴스 스니펫' if news else '')}을 종합하여 한국어로 요약하세요.
반드시 JSON으로만 출력. 키는 정확히: 이슈핵심, 여론경향, 대표반응, 팩트(뉴스근거), 결론

[키워드] {keyword}

[트윗 반응]
{tweets_block}

[뉴스]
{news_block}
""".strip()

  return [
    {"role":"system","content":system},
    {"role":"user","content":user}
  ]

def main():
  if len(sys.argv) < 2:
    print('{"error":"usage: python summarize.py <reactions_json> [news_json]"}')
    return

  reactions_json = sys.argv[1]
  news_json = sys.argv[2] if len(sys.argv) >= 3 else None

  rdata = load_json(reactions_json)
  reactions = rdata.get("reactions", [])
  keyword = rdata.get("keyword", "")

  news = []
  if news_json:
    ndata = load_json(news_json)
    # 배열 혹은 { items:[...] } 형태 모두 수용
    if isinstance(ndata, list):
      news = ndata
    else:
      news = ndata.get("news", ndata.get("items", []))

  tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=HF_TOKEN, use_fast=True)
  model = AutoModelForCausalLM.from_pretrained(
      MODEL_ID,
      device_map="auto" if torch.cuda.is_available() else None,
      torch_dtype=(torch.float16 if torch.cuda.is_available() else torch.float32),
      token=HF_TOKEN
  )
  if not torch.cuda.is_available():
    model = model.to("cpu")

  messages = build_prompt(keyword, reactions, news)
  prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
  inputs = tokenizer(prompt, return_tensors="pt")
  if torch.cuda.is_available():
    inputs = {k: v.cuda() for k, v in inputs.items()}

  with torch.inference_mode():
    out_ids = model.generate(
      **inputs, max_new_tokens=400, temperature=0.4, top_p=0.9, repetition_penalty=1.05
    )

  text = tokenizer.decode(out_ids[0], skip_special_tokens=True)
  s = text.find("{"); e = text.rfind("}")
  j = text[s:e+1] if (s != -1 and e != -1 and e > s) else '{"이슈핵심":"","여론경향":{"긍정":0,"부정":0,"중립":0},"대표반응":[],"팩트(뉴스근거)":[], "결론":""}'
  print(j)

if __name__ == "__main__":
  main()

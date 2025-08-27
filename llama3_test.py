import os
import sys
import json
import time
import argparse
from typing import List, Dict, Any

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TextStreamer,
)

DEFAULT_MODEL_ID = "meta-llama/Meta-Llama-3-8B-Instruct"
DEFAULT_DATASET_ID = "kangsungmin/Llama3-issues1"


def parse_args():
    p = argparse.ArgumentParser(
        description="Load Llama3 model and run inference over kangsungmin/Llama3-issues1 dataset."
    )
    p.add_argument("--model_id", type=str, default=DEFAULT_MODEL_ID,
                   help="HF model repo id (e.g., meta-llama/Meta-Llama-3-8B-Instruct)")
    p.add_argument("--dataset_id", type=str, default=DEFAULT_DATASET_ID,
                   help="HF dataset repo id (e.g., kangsungmin/Llama3-issues1)")
    p.add_argument("--split", type=str, default="train",
                   help="Dataset split name (e.g., train/validation/test or custom).")
    p.add_argument("--num_samples", type=int, default=3,
                   help="How many samples to run.")
    p.add_argument("--use_4bit", action="store_true",
                   help="Use 4-bit quantization (requires bitsandbytes + CUDA).")
    p.add_argument("--max_new_tokens", type=int, default=320)
    p.add_argument("--temperature", type=float, default=0.7)
    p.add_argument("--top_p", type=float, default=0.9)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--token", type=str, default=None,
                   help="HF token (or set HUGGINGFACEHUB_API_TOKEN env var).")
    return p.parse_args()


def load_tokenizer_and_model(model_id: str, use_4bit: bool, token: str | None):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[info] device={device}, use_4bit={use_4bit}")

    tok_kwargs = {}
    if token:
        tok_kwargs["token"] = token

    tokenizer = AutoTokenizer.from_pretrained(model_id, use_fast=True, **tok_kwargs)

    model_kwargs: Dict[str, Any] = {
        "torch_dtype": torch.float16 if device == "cuda" else torch.float32,
        "device_map": "auto" if device == "cuda" else None,
    }
    if token:
        model_kwargs["token"] = token

    if use_4bit and device == "cuda":
        try:
            import bitsandbytes as bnb  # noqa: F401
            model_kwargs.update({
                "load_in_4bit": True,
                "bnb_4bit_quant_type": "nf4",
                "bnb_4bit_use_double_quant": True,
                "bnb_4bit_compute_dtype": torch.float16,
            })
            print("[info] 4-bit quantization enabled.")
        except Exception as e:
            print(f"[warn] bitsandbytes unavailable -> fallback to full precision: {e}")

    model = AutoModelForCausalLM.from_pretrained(model_id, **model_kwargs)
    if device == "cpu":
        model = model.to(device)

    return tokenizer, model


def normalize_sample(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    데이터셋 레코드에서 topic/keyword와 posts(문장 리스트)를 최대한 유연하게 추출.
    필드명이 다르면 가능한 값을 추정하고, 없으면 문자열 필드를 긁어모아 posts로 사용.
    """
    keys = set(record.keys())

    # 흔한 후보들
    topic = (
        record.get("topic")
        or record.get("keyword")
        or record.get("subject")
        or record.get("title")
    )

    # posts 후보들 (list[str] 형태가 가장 이상적)
    posts = (
        record.get("posts")
        or record.get("tweets")
        or record.get("items")
        or record.get("docs")
        or record.get("sentences")
    )

    # 단일 텍스트인 경우 리스트로 감싸기
    if isinstance(posts, str):
        posts = [posts]
    # dict/obj면 사람이 읽을 수 있게 문자열화
    if isinstance(posts, dict):
        posts = [json.dumps(posts, ensure_ascii=False)]

    # posts가 비어있다면, 레코드 내의 문자열 필드를 모아서 구성
    if not posts:
        collected: List[str] = []
        for k, v in record.items():
            if isinstance(v, str) and v.strip():
                collected.append(v.strip())
        posts = collected if collected else [json.dumps(record, ensure_ascii=False)]

    if not topic:
        # topic이 없으면 posts 앞부분에서 대충 추출(보완용)
        topic = (posts[0][:40] + "...") if posts and isinstance(posts[0], str) else "이슈"

    # 문자열 아닌 요소는 문자열화
    posts = [p if isinstance(p, str) else json.dumps(p, ensure_ascii=False) for p in posts]

    return {"topic": topic, "posts": posts}


def build_chat_prompt(tokenizer, topic: str, posts: List[str]) -> str:
    """
    Llama3-Instruct 스타일의 chat 템플릿을 사용.
    - 모델이 한국어 요약을 안정적으로 내도록 시스템/사용자 역할 구성
    """
    posts_block = "\n".join([f"- {p}" for p in posts[:20]])  # 너무 길면 상위 20개만
    user_content = f"""다음 주제에 대한 X(트위터) 사용자 반응을 한국어로 간결하게 요약하세요.
요구사항:
1) 왜 이슈인지 핵심 1~2문장
2) 긍/부정/중립 대략적 경향(정량 추정치여도 됨)
3) 대표 주장/우려/밈 2~4개 불릿
4) 결론: 지금 주목 포인트 한 줄

[주제] {topic}

[수집된 글 일부]
{posts_block}

[형식]
- 이슈 핵심:
- 여론 경향(대략치):
- 대표 반응:
  • ...
  • ...
- 결론:
""".strip()

    messages = [
        {"role": "system", "content": "당신은 실시간 이슈 요약 전문가입니다. 간결하고 사실적으로 요약하세요."},
        {"role": "user", "content": user_content},
    ]
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


@torch.inference_mode()
def generate_once(tokenizer, model, prompt: str, max_new_tokens=320, temperature=0.7, top_p=0.9):
    inputs = tokenizer(prompt, return_tensors="pt")
    if torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}

    streamer = TextStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    output_ids = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        do_sample=True,
        top_p=top_p,
        repetition_penalty=1.05,
        streamer=streamer,  # 실시간 토큰 출력
    )
    text = tokenizer.decode(output_ids[0], skip_special_tokens=True)
    return text


def main():
    args = parse_args()
    torch.manual_seed(args.seed)

    token = args.token or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    if not token:
        print("[note] HUGGINGFACEHUB_API_TOKEN이 없으면 공개/게이트 상태에 따라 접근이 거부될 수 있습니다.")

    print("[info] 모델 로드 시작")
    t0 = time.time()
    tokenizer, model = load_tokenizer_and_model(args.model_id, args.use_4bit, token)
    print(f"[info] 모델 로드 완료: {time.time() - t0:.1f}s\n")

    print(f"[info] 데이터셋 로드: {args.dataset_id} / split={args.split}")
    try:
        dataset = load_dataset(args.dataset_id, split=args.split, token=token)
    except Exception as e:
        print(f"[error] 데이터셋 로드 실패: {e}")
        print(" - split 이름이 맞는지 또는 권한/토큰이 필요한지 확인하세요.")
        sys.exit(1)

    n = min(args.num_samples, len(dataset))
    print(f"[info] 총 {len(dataset)}개 중 {n}개 샘플을 생성합니다.\n")

    for i in range(n):
        rec = normalize_sample(dataset[i])
        topic, posts = rec["topic"], rec["posts"]

        print("=" * 80)
        print(f"[sample #{i+1}] topic: {topic}")
        print("- posts preview:", posts[:3], "..." if len(posts) > 3 else "")
        prompt = build_chat_prompt(tokenizer, topic, posts)

        print("\n[gen] 생성 시작 ↓↓↓\n")
        _ = generate_once(
            tokenizer,
            model,
            prompt,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            top_p=args.top_p,
        )
        print("\n[done]\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[interrupt] 사용자 중단")
        sys.exit(1)


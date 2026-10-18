"""news-nlp CLI: run the pipeline, serve the API, or score ad-hoc text."""
from __future__ import annotations

import argparse
import json
import sys

from .src import pipeline, sentiment
from .src.settings import settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="news-nlp", description="Financial-text NLP stage")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run_p = sub.add_parser("run", help="raw → silver → gold (score, NER, cluster, persist)")
    run_p.add_argument("--raw", default=None, help="path to raw headlines JSON")

    serve_p = sub.add_parser("serve", help="run the FastAPI service")
    serve_p.add_argument("--host", default=settings.host)
    serve_p.add_argument("--port", type=int, default=settings.port)

    score_p = sub.add_parser("score", help="score one or more texts from argv")
    score_p.add_argument("text", nargs="+")

    args = parser.parse_args(argv)

    if args.cmd == "run":
        result = pipeline.run(args.raw)
        print(json.dumps(result, indent=2))
    elif args.cmd == "serve":
        import uvicorn

        uvicorn.run("news_nlp.src.api:app", host=args.host, port=args.port)
    elif args.cmd == "score":
        for item, text in zip(sentiment.score_texts(args.text), args.text):
            print(f"{item.score:+.3f}  {item.label:<7}  {text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Rewrite the "Formulas" section of docs/guides/markets/vixr-whitepaper.md from docs/guides/markets/vixr-formulas.tex,
which is the single source. A unit test fails if the two drift apart.

Usage: python3 scripts/fixtures/sync_vixr_formulas.py
"""
import pathlib
import re

DOCS = pathlib.Path(__file__).resolve().parents[2] / "docs" / "guides" / "markets"
START = "## Formulas"
END = "## Data and provenance"

INTRO = (
    "Every formula the module evaluates, in LaTeX. Each block can be pasted into a document; the complete, compilable "
    "file is `docs/guides/markets/vixr-formulas.tex`, and the VIXR page has a **Formulas** panel with copy and download "
    "buttons. This section is generated from that file."
)


def sections(tex):
    body = tex[tex.index("\\begin{document}") + len("\\begin{document}"): tex.rindex("\\end{document}")]
    parts = re.split(r"\\subsection\*\{([^}]*)\}", body)
    return [(parts[i].strip(), parts[i + 1].strip()) for i in range(1, len(parts), 2)]


def main():
    tex = (DOCS / "vixr-formulas.tex").read_text()
    md_path = DOCS / "vixr-whitepaper.md"
    md = md_path.read_text()
    block = [START, "", INTRO, ""]
    for title, latex in sections(tex):
        block += [f"### {title}", "", "```latex", latex, "```", ""]
    new = "\n".join(block) + "\n"
    if START in md:
        head, rest = md.split(START, 1)
        tail = rest[rest.index(END):]
        md = head + new + tail
    else:
        md = md.replace(END, new + END, 1)
    md_path.write_text(md)
    print("sections:", len(sections(tex)))


if __name__ == "__main__":
    main()

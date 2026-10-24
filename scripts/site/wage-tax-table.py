#!/usr/bin/env python3
"""Converts the text of 소득세법 시행령 [별표 2] 근로소득 간이세액표 into the JSON
used by /tools/salary/.

    pdftotext -layout <별표2.pdf> table.txt
    python3 scripts/site/wage-tax-table.py table.txt assetdist/tools/salary/tax-table.json

Each row is [이상(천원), 미만(천원), 세액 for 공제대상가족 1..11]; "-" becomes 0.
The script refuses to write unless the rows are contiguous from 770 to
10,000천원 and every column is non-decreasing with salary and non-increasing
with family size, so a mis-parsed page cannot slip through.
"""
import json
import re
import sys

ROW = re.compile(r"^([\d,]+)\s+([\d,]+)\s+((?:(?:[\d,]+|-)\s+){10}(?:[\d,]+|-))$")
TOP = re.compile(r"^10,000천원\s+((?:[\d,]+\s+){10}[\d,]+)$")


def number(text):
    return 0 if text == "-" else int(text.replace(",", ""))


def main(source, target):
    rows, top, revision = [], None, None
    for line in open(source, encoding="utf-8"):
        text = line.strip()
        if revision is None:
            found = re.search(r"\[별표 2\]\s*<개정\s*([\d. ]+)>", text)
            if found:
                revision = found.group(1).strip()
        match = ROW.match(text)
        if match:
            rows.append([number(match.group(1)), number(match.group(2))] + [number(v) for v in match.group(3).split()])
            continue
        match = TOP.match(text)
        if match:
            top = [number(v) for v in match.group(1).split()]
    if not rows or top is None or revision is None:
        raise SystemExit("table text not recognised")
    if rows[0][0] != 770 or rows[-1][1] != 10000:
        raise SystemExit("table must span 770 to 10,000 천원")
    for previous, current in zip(rows, rows[1:]):
        if previous[1] != current[0]:
            raise SystemExit(f"gap between {previous[:2]} and {current[:2]}")
        if any(current[i] < previous[i] for i in range(2, 13)):
            raise SystemExit(f"tax decreases at {current[:2]}")
    for row in rows + [[10000, 10000] + top]:
        if any(row[i] > row[i - 1] for i in range(3, 13)):
            raise SystemExit(f"tax rises with family size at {row[:2]}")
    data = {
        "source": "소득세법 시행령 [별표 2] 근로소득 간이세액표",
        "revision": revision,
        "unit": "rows: [이상 천원, 미만 천원, 공제대상가족 1..11명 세액(원)]",
        "rows": rows,
        "at10000": top,
    }
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    print(f"{len(rows)} rows, revision {revision}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])

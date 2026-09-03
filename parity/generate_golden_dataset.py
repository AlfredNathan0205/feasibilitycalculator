#!/usr/bin/env python3
"""
Parity harness — Build Prompt §10 items 1-3.

Connects to a running headless LibreOffice instance over UNO, opens the
*actual* uploaded workbook, and drives it across the full cross-product of
inputs specified in §10:

    4 tiers x 3 new/rework x 3 brief types x 2 customer approvals
    x 2 niche flags x 2 strategic flags x 3 creative approaches
    x 9 values (0, 1, 1000, 30000, 35000, 100000, 115000, 200000, 1000000)

  = 7776 combinations.

For each combination it writes the inputs into Calculator!B2..B9, forces a
full recalculation, and reads back:
  - D16 (total score)
  - E16 (approval text)
  - E9  (creative-approach approval note, non-blank => workbook would fold
         this into "Pending Approval" even though the new engine's Stage A
         does not consider it — needed to classify expected deviations)
  - B14 (Auto-Approval (Dev) flag — "Yes" when Rework(Of Selling) or niche)

Deadline (B13) and resource flags (C10:C12) are held fixed/neutral for this
run: deadline far in the future (today+60, well outside even the workbook's
stale 21-day window) and resource flags False, because deadline/resource
triggers aren't part of this cross-product (§10 item 2's dimension list
doesn't include them) — they're covered separately by the engine's own unit
tests (§10 item 6 "full ladder coverage").

Output: /home/claude/parity/golden-dataset.csv
"""

import csv
import itertools
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def make_prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def connect(retries=20, delay=1):
    local_ctx = uno.getComponentContext()
    resolver = local_ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_ctx
    )
    last_err = None
    for _ in range(retries):
        try:
            ctx = resolver.resolve(
                "uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext"
            )
            return ctx
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(delay)
    raise last_err


def main():
    workbook_path = sys.argv[1] if len(sys.argv) > 1 else (
        "/mnt/user-data/uploads/Project-Feasibility-Calculator.xlsx"
    )
    out_path = sys.argv[2] if len(sys.argv) > 2 else (
        "/home/claude/parity/golden-dataset.csv"
    )

    ctx = connect()
    smgr = ctx.ServiceManager
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)

    url = uno.systemPathToFileUrl(workbook_path)
    props = [
        make_prop("Hidden", True),
        make_prop("ReadOnly", False),
    ]
    document = desktop.loadComponentFromURL(url, "_blank", 0, tuple(props))

    try:
        sheets = document.getSheets()
        calc = sheets.getByName("Calculator")

        # --- LibreOffice XLOOKUP compatibility shim ---------------------
        # This sandbox's LibreOffice build (24.2) predates native XLOOKUP
        # support (added in 24.8), so the workbook's own _xlfn.XLOOKUP
        # formulas evaluate to #NAME? and get silently swallowed by
        # IFERROR into blank/0 for every lookup-based score component.
        # Confirmed by direct probing: =XLOOKUP(...) and =_xlfn.XLOOKUP(...)
        # both return #NAME? (error code 525) in a fresh test sheet in this
        # environment, regardless of the source workbook.
        #
        # This is an environment limitation, not a data or spec problem —
        # production Excel handles the real formulas correctly, and the
        # deliverable workbook/spec are untouched by this. For parity
        # generation only, each affected formula is rewritten to the
        # exact-match INDEX/MATCH equivalent, which is mathematically
        # identical to XLOOKUP's default (exact match) mode:
        #   XLOOKUP(a, b, c) == INDEX(c, MATCH(a, b, 0))
        # Verified by hand against a known combination (A/T, £200k, New,
        # Exclusive, Direct, Library Only -> total score 900) before running
        # the full cross-product.
        xlookup_patches = {
            "D2": '=IFERROR(INDEX(Reference.B2:B5;MATCH(B2;Reference.A2:A5;0));"")',
            "D4": '=IFERROR(D3*INDEX(Reference.E2:E4;MATCH(B4;Reference.D2:D4;0));"")',
            "D5": '=IFERROR(D3*INDEX(Reference.H2:H4;MATCH(B5;Reference.G2:G4;0));"")',
            "D6": '=IFERROR(D3*INDEX(Reference.K2:K3;MATCH(B6;Reference.J2:J3;0));"")',
            "D9": '=IFERROR(INDEX(Reference.N2:N4;MATCH(B9;Reference.M2:M4;0));"")',
        }
        for addr, formula in xlookup_patches.items():
            calc.getCellRangeByName(addr).setFormula(formula)

        def set_str(addr, value):
            calc.getCellRangeByName(addr).setString(value)

        def set_bool(addr, value):
            calc.getCellRangeByName(addr).setValue(1 if value else 0)

        def set_formula(addr, formula):
            calc.getCellRangeByName(addr).setFormula(formula)

        def get_str(addr):
            return calc.getCellRangeByName(addr).getString()

        def get_num(addr):
            # getString() applies the cell's display number format (which
            # can round/truncate decimals, e.g. £ formatting with 0 decimal
            # places) — use getValue() for the actual underlying double so
            # fractional scores (e.g. from the -0.5 ProActive multiplier or
            # small value potentials) aren't silently rounded away in the
            # golden dataset.
            return calc.getCellRangeByName(addr).getValue()

        # Fixed/neutral inputs for this cross-product run.
        set_formula("B13", "=TODAY()+60")  # deadline: outside any short window
        set_bool("C10", False)  # marketing
        set_bool("C11", False)  # ppd
        set_bool("C12", False)  # gcms

        tiers = ["A/T", "B", "C", "D"]
        new_reworks = ["New", "Rework (Of Selling)", "Rework (Non-Selling)"]
        brief_types = ["Exclusive", "Competitive", "ProActive"]
        customer_approvals = ["Direct", "Deferred/Unknown"]
        niche_flags = [False, True]
        strategic_flags = [False, True]
        creative_approaches = ["Library Only", "Starting Point", "Creation/Unknown"]
        values = [0, 1, 1000, 30000, 35000, 100000, 115000, 200000, 1000000]

        combos = list(
            itertools.product(
                tiers,
                new_reworks,
                brief_types,
                customer_approvals,
                niche_flags,
                strategic_flags,
                creative_approaches,
                values,
            )
        )

        print(f"Total combinations: {len(combos)}", file=sys.stderr)

        rows = []
        t0 = time.time()
        for i, (
            tier,
            new_rework,
            brief_type,
            customer_approval,
            niche,
            strategic,
            creative,
            value,
        ) in enumerate(combos):
            set_str("B2", tier)
            calc.getCellRangeByName("B3").setValue(value)
            set_str("B4", new_rework)
            set_str("B5", brief_type)
            set_str("B6", customer_approval)
            set_bool("B7", niche)
            set_bool("B8", strategic)
            set_str("B9", creative)

            document.calculateAll()

            score_str = get_num("D16")
            approval_text = get_str("E16")
            e9_text = get_str("E9")
            b14_text = get_str("B14")

            rows.append(
                {
                    "tier": tier,
                    "new_rework": new_rework,
                    "brief_type": brief_type,
                    "customer_approval": customer_approval,
                    "niche_ff_pre_approved": niche,
                    "strategic_priority": strategic,
                    "creative_approach": creative,
                    "value_potential_gbp": value,
                    "workbook_score": score_str,
                    "workbook_approval_text": approval_text,
                    "workbook_e9_creative_note": e9_text,
                    "workbook_b14_auto_approval_dev": b14_text,
                }
            )

            if (i + 1) % 500 == 0:
                elapsed = time.time() - t0
                print(
                    f"  {i + 1}/{len(combos)} ({elapsed:.1f}s elapsed)",
                    file=sys.stderr,
                )

        with open(out_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

        print(f"Wrote {len(rows)} rows to {out_path}", file=sys.stderr)

    finally:
        document.close(False)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Bundle pre-generated fleet health results into public/data/ for Harmony deployment.

Reads from ~/myeeroai_results/_shared/ and produces:
  public/data/results.json         — list of available runs
  public/data/exec_summary.json    — fleet_health exec summaries by category
  public/data/ap_client_exec_summary.json
  public/data/oncall_index.json    — oncall report listing
  public/data/oncall/              — HTML reports (last 14 days)
  public/data/fleet_health/        — latest 3 runs per category
  public/data/ap_client_health/    — latest 3 runs per category
  public/data/jira_mesh.json       — enriched Jira tickets for mesh metrics
  public/data/jira_ap_client.json  — enriched Jira tickets for AP-client metrics
"""

import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RESULTS_DIR = Path.home() / "myeeroai_results" / "_shared"
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "public" / "data"
MAX_RUNS_PER_CATEGORY = 3
ONCALL_DAYS = 14

# Category classification (run name prefix → category)
CATEGORY_MAP = {
    "stage_0_2_": "stage",
    "prod_2_3_": "beta",
    "prod_0_": "prod",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def classify_run(run_name):
    """Classify a run name into stage/beta/prod category."""
    for prefix, cat in CATEGORY_MAP.items():
        if run_name.startswith(prefix):
            return cat
    return None


def get_run_timestamp(run_name):
    """Extract timestamp from run directory name for sorting."""
    # Format: prefix_YYYY-MM-DD_HHMMSS
    m = re.search(r'(\d{4}-\d{2}-\d{2}_\d{6})', run_name)
    if m:
        return m.group(1)
    return "0000-00-00_000000"


def is_valid_run(run_path):
    """A valid run has at least an analysis/ dir or ppm/ dir."""
    return (run_path / "analysis").is_dir() or (run_path / "ppm").is_dir()


def get_latest_runs(pipeline_dir, max_per_cat=MAX_RUNS_PER_CATEGORY):
    """Get latest N runs per category from a pipeline directory."""
    if not pipeline_dir.is_dir():
        return {}

    runs_by_cat = {"stage": [], "beta": [], "prod": []}

    for entry in sorted(pipeline_dir.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        cat = classify_run(entry.name)
        if cat is None:
            continue
        if not is_valid_run(entry):
            continue
        if len(runs_by_cat[cat]) < max_per_cat:
            runs_by_cat[cat].append(entry)

    return runs_by_cat


def copy_run(src_dir, dest_dir):
    """Copy a run directory, skipping very large raw data files."""
    dest_dir.mkdir(parents=True, exist_ok=True)

    for item in src_dir.iterdir():
        dest_item = dest_dir / item.name

        if item.is_dir():
            if item.name == "raw":
                # Skip raw data (too large for static site)
                continue
            if dest_item.exists():
                shutil.rmtree(dest_item)
            shutil.copytree(str(item), str(dest_item))
        elif item.is_file():
            # Skip files > 5MB (large logs, etc.)
            if item.stat().st_size > 5 * 1024 * 1024:
                continue
            shutil.copy2(str(item), str(dest_item))


# ---------------------------------------------------------------------------
# Step 1: Copy latest runs for fleet_health and ap_client_health
# ---------------------------------------------------------------------------

def copy_pipeline_runs():
    """Copy latest 3 runs per category for each pipeline."""
    results = []

    for pipeline in ("fleet_health", "ap_client_health", "acs_health"):
        pipeline_dir = RESULTS_DIR / pipeline
        runs_by_cat = get_latest_runs(pipeline_dir)

        for cat, runs in runs_by_cat.items():
            for run_dir in runs:
                dest = DATA_DIR / pipeline / run_dir.name
                print(f"  Copying {pipeline}/{run_dir.name} ({cat})")
                copy_run(run_dir, dest)
                results.append({
                    "pipeline": pipeline,
                    "category": cat,
                    "name": run_dir.name,
                    "path": f"/data/{pipeline}/{run_dir.name}",
                    "timestamp": get_run_timestamp(run_dir.name),
                })

    return results


# ---------------------------------------------------------------------------
# Step 2: Generate results.json
# ---------------------------------------------------------------------------

def generate_results_json(runs):
    """Generate results.json listing all available runs."""
    # Sort by timestamp descending
    runs.sort(key=lambda r: r["timestamp"], reverse=True)

    out_path = DATA_DIR / "results.json"
    out_path.write_text(json.dumps(runs, indent=2))
    print(f"  Generated {out_path.name} ({len(runs)} runs)")
    return runs


# ---------------------------------------------------------------------------
# Step 3: Generate exec_summary.json
# ---------------------------------------------------------------------------

def generate_exec_summary(pipeline, output_name):
    """Read exec_summary.json from each run's analysis/ dir and combine by category."""
    pipeline_dir = RESULTS_DIR / pipeline
    # Scan more runs (up to 20) to find ones that have exec_summary
    runs_by_cat = get_latest_runs(pipeline_dir, max_per_cat=20)

    url_prefix = "ap-client-metric" if "ap_client" in pipeline else "fleet-metric"
    summaries = {}
    for cat, runs in runs_by_cat.items():
        cat_list = []
        for run_dir in runs:
            es_path = run_dir / "analysis" / "exec_summary.json"
            if es_path.exists():
                try:
                    data = json.loads(es_path.read_text())
                    # Add fields the JS expects
                    data["run"] = run_dir.name
                    data["dashboard_url"] = f"/data/{pipeline}/{run_dir.name}/dashboard.html"
                    data["summary_url"] = f"/data/{pipeline}/{run_dir.name}/exec_summary.html"
                    cat_list.append(data)
                    print(f"  Loaded {pipeline} exec_summary for {cat} from {run_dir.name}")
                except (json.JSONDecodeError, IOError) as e:
                    print(f"  WARNING: Failed to read {es_path}: {e}")
            if len(cat_list) >= 3:
                break
        if cat_list:
            summaries[cat] = cat_list

    out_path = DATA_DIR / output_name
    out_path.write_text(json.dumps(summaries, indent=2))
    print(f"  Generated {output_name}")


# ---------------------------------------------------------------------------
# Step 4: Generate oncall_index.json and copy reports
# ---------------------------------------------------------------------------

def copy_oncall_reports():
    """Copy oncall HTML reports from the last 14 days."""
    oncall_dir = RESULTS_DIR / "oncall"
    if not oncall_dir.is_dir():
        print("  WARNING: No oncall directory found")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=ONCALL_DAYS)
    cutoff_str = cutoff.strftime("%Y-%m-%d")

    dest_oncall = DATA_DIR / "oncall"
    dest_oncall.mkdir(parents=True, exist_ok=True)

    index = []
    for entry in sorted(oncall_dir.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        # Format: YYYY-MM-DD_HHMMSS
        date_part = entry.name[:10]
        if date_part < cutoff_str:
            break

        # Copy the directory (tickets/ subdir + HTML files)
        dest_entry = dest_oncall / entry.name
        if entry.is_dir():
            if dest_entry.exists():
                shutil.rmtree(dest_entry)
            shutil.copytree(str(entry), str(dest_entry))

        # Build index entry
        index.append({
            "name": entry.name,
            "path": f"/data/oncall/{entry.name}",
            "date": date_part,
            "time": entry.name[11:] if len(entry.name) > 11 else "",
        })

    out_path = DATA_DIR / "oncall_index.json"
    out_path.write_text(json.dumps(index, indent=2))
    print(f"  Generated oncall_index.json ({len(index)} reports)")


# ---------------------------------------------------------------------------
# Step 5: Sync Jira tickets
# ---------------------------------------------------------------------------

def sync_jira_tickets():
    """Fetch and enrich Jira tickets for mesh and AP-client metrics."""
    # Import jira_client from existing location
    sys.path.insert(0, str(Path.home() / "bharat_sandbox/myeeroai_web_v1/eero_agents"))
    try:
        from jira_client import search_issues, has_token, jira_get
    except ImportError as e:
        print(f"  WARNING: Cannot import jira_client: {e}")
        return

    if not has_token():
        print("  WARNING: No Jira token configured — skipping Jira sync")
        return

    configs = [
        {
            "labels": "mesh-metrics-review, eero-ai-mesh-metric",
            "output": "jira_mesh.json",
            "name": "mesh",
        },
        {
            "labels": "ap-client-metrics-review, eero-ai-ap-client-metric",
            "output": "jira_ap_client.json",
            "name": "ap-client",
        },
    ]

    for cfg in configs:
        print(f"  Fetching {cfg['name']} Jira tickets...")
        try:
            jql = "project=CONN AND labels in (%s) ORDER BY created DESC" % cfg["labels"]
            tickets = search_issues(jql, max_results=200)

            # Enrich each ticket
            for t in tickets:
                # Parse metric name from summary: "[Fleet Health] metric_name ..."
                m = re.search(r'\]\s*(\w+)', t.get("summary", ""))
                t["metric"] = m.group(1) if m else ""

                # Check PR status
                t["has_pr"] = False
                t["pr_url"] = ""
                t["dup_of"] = ""

                check_keys = []
                if t.get("resolution") == "Code Changed":
                    check_keys.append(t["key"])
                elif t.get("resolution") == "Duplicate":
                    try:
                        iss = jira_get("/rest/api/2/issue/%s?fields=issuelinks" % t["key"])
                        for link in iss.get("fields", {}).get("issuelinks", []):
                            if link.get("type", {}).get("name") == "Duplicate":
                                dup_key = (link.get("inwardIssue", {}).get("key") or
                                           link.get("outwardIssue", {}).get("key", ""))
                                if dup_key:
                                    t["dup_of"] = dup_key
                                    check_keys.append(dup_key)
                    except Exception:
                        pass

                for ck in check_keys:
                    try:
                        iss_data = jira_get("/rest/api/2/issue/%s" % ck)
                        dev = jira_get("/rest/dev-status/latest/issue/summary?issueId=%s" % iss_data["id"])
                        pr_info = dev.get("summary", {}).get("pullrequest", {}).get("overall", {})
                        if pr_info.get("count", 0) > 0 and pr_info.get("state") == "MERGED":
                            t["has_pr"] = True
                            t["pr_state"] = pr_info.get("state", "")
                            # Get PR URL
                            try:
                                det = jira_get(
                                    "/rest/dev-status/latest/issue/detail?issueId=%s"
                                    "&applicationType=GitHub&dataType=pullrequest" % iss_data["id"]
                                )
                                for d in det.get("detail", []):
                                    for pr in d.get("pullRequests", []):
                                        t["pr_url"] = pr.get("url", "")
                                        break
                            except Exception:
                                pass
                            break
                    except Exception:
                        pass

            result = {
                "ok": True,
                "synced_at": datetime.now(timezone.utc).isoformat(),
                "tickets": tickets,
            }

            out_path = DATA_DIR / cfg["output"]
            out_path.write_text(json.dumps(result, indent=2))
            print(f"  Generated {cfg['output']} ({len(tickets)} tickets)")

        except Exception as e:
            print(f"  ERROR syncing {cfg['name']} Jira: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    start = time.time()
    print("=" * 60)
    print("eero-fleet Harmony build_site.py")
    print("=" * 60)
    print(f"Results dir: {RESULTS_DIR}")
    print(f"Output dir:  {DATA_DIR}")
    print()

    # Clean output
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
    DATA_DIR.mkdir(parents=True)

    # Step 1: Copy pipeline runs
    print("[1/5] Copying latest pipeline runs...")
    runs = copy_pipeline_runs()
    print()

    # Step 2: Generate results.json
    print("[2/5] Generating results.json...")
    generate_results_json(runs)
    print()

    # Step 3: Generate exec summaries
    print("[3/5] Generating exec summaries...")
    generate_exec_summary("fleet_health", "exec_summary.json")
    generate_exec_summary("ap_client_health", "ap_client_exec_summary.json")
    print()

    # Step 4: Copy oncall reports
    print("[4/5] Copying oncall reports (last %d days)..." % ONCALL_DAYS)
    copy_oncall_reports()
    print()

    # Step 5: Sync Jira
    print("[5/5] Syncing Jira tickets...")
    sync_jira_tickets()
    print()

    # Step 6: Fix CSP issues in all data HTML files
    print("[6/6] Fixing CSP in HTML files...")
    import re as _re_csp

    # Replace CDN Plotly with local copy (CSP blocks external scripts)
    plotly_cdn = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2/plotly.min.js"
    plotly_local = "/plotly.min.js"
    cdn_count = 0
    inject_count = 0
    for html_file in DATA_DIR.rglob("*.html"):
        content = html_file.read_text(errors='ignore')
        if '/csp-fix.js' in content:
            continue
        modified = False

        # Always inject csp-fix.js into dashboard.html (has inline style attributes)
        if html_file.name == 'dashboard.html' and '</head>' in content:
            content = content.replace('</head>', '<script src="/csp-fix.js"></script>\n</head>')
            modified = True

        # Replace Plotly CDN with local
        if plotly_cdn in content:
            content = content.replace(plotly_cdn, plotly_local)
            cdn_count += 1
            modified = True

        # Extract inline <style>...</style> blocks into external .css file
        style_pattern = _re_csp.compile(r'<style>(.*?)</style>', _re_csp.DOTALL)
        styles = style_pattern.findall(content)
        if styles:
            css_name = html_file.stem + "_inline.css"
            css_path = html_file.parent / css_name
            css_path.write_text("\n".join(styles))
            content = style_pattern.sub('', content)
            # Add link to CSS in <head>
            if '</head>' in content:
                content = content.replace('</head>', f'<link rel="stylesheet" href="{css_name}">\n</head>')
            modified = True

        # Extract inline <script>...</script> blocks into external .js file
        script_pattern = _re_csp.compile(r'<script>(.*?)</script>', _re_csp.DOTALL)
        scripts = script_pattern.findall(content)
        if scripts:
            js_name = html_file.stem + "_inline.js"
            js_path = html_file.parent / js_name
            js_path.write_text("\n".join(scripts))
            content = script_pattern.sub('', content)
            inject_tag = f'<script src="/csp-fix.js"></script>\n<script src="{js_name}"></script>\n'
            if '</body>' in content:
                content = content.replace('</body>', inject_tag + '</body>')
            else:
                content += inject_tag
            modified = True
        elif not modified and '<script' in content:
            content = content.replace('<script', '<script src="/csp-fix.js"></script>\n<script', 1)
            modified = True

        if modified:
            html_file.write_text(content)
            inject_count += 1

    print(f"  Fixed CSP in {inject_count} HTML files (Plotly CDN replaced in {cdn_count})")
    print()

    # Summary
    elapsed = time.time() - start
    total_size = sum(f.stat().st_size for f in DATA_DIR.rglob("*") if f.is_file())
    print("=" * 60)
    print(f"✅ Build complete in {elapsed:.1f}s")
    print(f"   Total data size: {total_size / 1024 / 1024:.1f} MB")
    print(f"   Output: {DATA_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()

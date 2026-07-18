#!/bin/bash
# deploy.sh — Build data bundle and show deployment instructions for Harmony
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  eero-fleet Harmony — Build & Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Run build_site.py
echo "▶ Running build_site.py..."
echo ""
python3 build_site.py
echo ""

# Step 2: Show summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📊 Build Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Count generated files
DATA_DIR="$SCRIPT_DIR/public/data"
if [ -d "$DATA_DIR" ]; then
    echo "  Files generated:"
    echo "    results.json:              $([ -f "$DATA_DIR/results.json" ] && echo "✅" || echo "❌")"
    echo "    exec_summary.json:         $([ -f "$DATA_DIR/exec_summary.json" ] && echo "✅" || echo "❌")"
    echo "    ap_client_exec_summary.json: $([ -f "$DATA_DIR/ap_client_exec_summary.json" ] && echo "✅" || echo "❌")"
    echo "    oncall_index.json:         $([ -f "$DATA_DIR/oncall_index.json" ] && echo "✅" || echo "❌")"
    echo "    jira_mesh.json:            $([ -f "$DATA_DIR/jira_mesh.json" ] && echo "✅" || echo "❌")"
    echo "    jira_ap_client.json:       $([ -f "$DATA_DIR/jira_ap_client.json" ] && echo "✅" || echo "❌")"
    echo ""
    echo "  Directories:"
    [ -d "$DATA_DIR/fleet_health" ] && echo "    fleet_health/:     $(find "$DATA_DIR/fleet_health" -maxdepth 1 -type d | wc -l) runs"
    [ -d "$DATA_DIR/ap_client_health" ] && echo "    ap_client_health/: $(find "$DATA_DIR/ap_client_health" -maxdepth 1 -type d | wc -l) runs"
    [ -d "$DATA_DIR/oncall" ] && echo "    oncall/:           $(find "$DATA_DIR/oncall" -maxdepth 1 -type d | wc -l) reports"
    echo ""
    echo "  Total size: $(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Deploy to Harmony"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Install dependencies (first time only):"
echo "     pnpm install"
echo ""
echo "  2. Build the Harmony app:"
echo "     pnpm run build-harmony-app"
echo ""
echo "  3. Publish to Harmony:"
echo "     npm run prepublishOnly"
echo ""
echo "  Or for local development:"
echo "     pnpm dev"
echo "     → Opens https://local.ci.insight.e2ro.com:3000"
echo ""
echo "  Harmony console: https://console.harmony.a2z.com/"
echo "  Target URL:      https://eero-fleet.harmony.a2z.com"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

#!/usr/bin/env python3
"""Convert Plotly chart _inline.js files to uPlot format for CSP-compatible rendering."""
import json
import re
import sys
from pathlib import Path


def parse_plotly_call(js_content):
    """Extract traces and layout from Plotly.newPlot(...) call."""
    # Format: Plotly.newPlot("c",[{traces}],{layout},{config})
    try:
        # Find the traces array
        start = js_content.index('[')
        depth = 0
        for i, ch in enumerate(js_content[start:], start):
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
            if depth == 0:
                traces_str = js_content[start:i+1]
                break
        traces = json.loads(traces_str)

        # Find the layout object (after traces array)
        rest = js_content[i+1:].lstrip(',')
        layout_start = rest.index('{')
        depth = 0
        for j, ch in enumerate(rest[layout_start:], layout_start):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
            if depth == 0:
                layout_str = rest[layout_start:j+1]
                break
        layout = json.loads(layout_str)
        return traces, layout
    except Exception:
        return None, None


def plotly_to_uplot(traces, layout):
    """Convert Plotly trace data to uPlot data format."""
    if not traces:
        return None

    # uPlot data format: [[timestamps], [series1_values], [series2_values], ...]
    # timestamps must be unix seconds
    dates = traces[0].get('x', [])
    if not dates:
        return None

    # Convert date strings to unix timestamps
    timestamps = []
    for d in dates:
        try:
            # Handle "YYYY-MM-DD" format
            parts = d.split('-')
            import datetime
            dt = datetime.datetime(int(parts[0]), int(parts[1]), int(parts[2]))
            timestamps.append(int(dt.timestamp()))
        except Exception:
            timestamps.append(0)

    data = [timestamps]
    series_opts = [{}]  # first entry is for x-axis

    for t in traces:
        y_values = t.get('y', [])
        # Convert None to null for JSON
        data.append([v if v is not None else None for v in y_values])

        color = t.get('line', {}).get('color', '#4fc3f7')
        name = t.get('name', '')
        dash = t.get('line', {}).get('dash', '')
        width = t.get('line', {}).get('width', 2)

        series_opts.append({
            'label': name,
            'stroke': color,
            'width': width,
            'dash': [5, 5] if dash == 'dash' else None,
            'fill': t.get('fillcolor', None),
        })

    # Extract layout options
    bg = layout.get('paper_bgcolor', '#1e1e3a')
    plot_bg = layout.get('plot_bgcolor', '#252545')
    font_color = layout.get('font', {}).get('color', '#e0e0e0')
    y_title = layout.get('yaxis', {}).get('title', '')
    grid_color = layout.get('xaxis', {}).get('gridcolor', '#333')

    return {
        'data': data,
        'series': series_opts,
        'bg': bg,
        'plot_bg': plot_bg,
        'font_color': font_color,
        'y_title': y_title,
        'grid_color': grid_color,
    }


def generate_uplot_js(chart_data):
    """Generate uPlot JavaScript code."""
    data_json = json.dumps(chart_data['data'])
    series_json = json.dumps(chart_data['series'])

    return f'''(function() {{
  var data = {data_json};
  var seriesOpts = {series_json};

  var opts = {{
    width: document.getElementById("c").clientWidth || window.innerWidth,
    height: document.getElementById("c").clientHeight || window.innerHeight - 10,
    series: seriesOpts.map(function(s, i) {{
      if (i === 0) return {{}};
      var o = {{ label: s.label, stroke: s.stroke, width: s.width || 2 }};
      if (s.dash) o.dash = s.dash;
      if (s.fill) o.fill = s.fill;
      return o;
    }}),
    axes: [
      {{ stroke: "{chart_data['font_color']}", grid: {{ stroke: "{chart_data['grid_color']}" }},
         values: function(u, vals) {{ return vals.map(function(v) {{
           var d = new Date(v * 1000);
           return (d.getMonth()+1) + "/" + d.getDate();
         }}); }}
      }},
      {{ stroke: "{chart_data['font_color']}", grid: {{ stroke: "{chart_data['grid_color']}" }},
         label: "{chart_data['y_title']}",
         values: function(u, vals) {{ return vals.map(function(v) {{
           if (v >= 1e9) return (v/1e9).toFixed(1) + "B";
           if (v >= 1e6) return (v/1e6).toFixed(1) + "M";
           if (v >= 1e3) return (v/1e3).toFixed(0) + "K";
           return v;
         }}); }}
      }}
    ],
    scales: {{ x: {{ time: true }} }},
    cursor: {{ show: true }},
    legend: {{ show: true }},
  }};

  function render() {{
    var el = document.getElementById("c");
    el.innerHTML = "";
    opts.width = el.clientWidth || window.innerWidth;
    opts.height = el.clientHeight || window.innerHeight - 10;
    new uPlot(opts, data, el);
  }}
  if (document.readyState === "complete") render();
  else window.addEventListener("load", render);
  window.addEventListener("resize", function() {{ setTimeout(render, 100); }});
}})();'''


def convert_file(js_path):
    """Convert a single Plotly _inline.js file to uPlot format."""
    content = js_path.read_text()
    if not content.startswith('Plotly.newPlot'):
        return False

    traces, layout = parse_plotly_call(content)
    if not traces:
        return False

    chart_data = plotly_to_uplot(traces, layout)
    if not chart_data:
        return False

    uplot_js = generate_uplot_js(chart_data)
    js_path.write_text(uplot_js)
    return True


def convert_html(html_path):
    """Update chart HTML to use uPlot instead of Plotly."""
    content = html_path.read_text()
    # Replace plotly script with uplot
    content = content.replace(
        '<script nonce="s3cur3H4rmonyN0nc3" src="/plotly.min.js"></script>',
        '<link rel="stylesheet" href="/uplot.min.css">\n<script nonce="s3cur3H4rmonyN0nc3" src="/uplot.min.js"></script>'
    )
    # Also handle non-nonce version
    content = content.replace(
        '<script src="/plotly.min.js"></script>',
        '<link rel="stylesheet" href="/uplot.min.css">\n<script src="/uplot.min.js"></script>'
    )
    html_path.write_text(content)


def main():
    if len(sys.argv) < 2:
        print("Usage: convert_to_uplot.py <data_dir>")
        sys.exit(1)

    data_dir = Path(sys.argv[1])
    converted = 0
    failed = 0

    for js_file in data_dir.rglob("*_inline.js"):
        if "charts" not in str(js_file):
            continue
        content = js_file.read_text()
        if not content.startswith('Plotly.newPlot'):
            continue
        if convert_file(js_file):
            converted += 1
            # Also update the corresponding HTML file
            html_name = js_file.name.replace('_inline.js', '.html')
            html_path = js_file.parent / html_name
            if html_path.exists():
                convert_html(html_path)
        else:
            failed += 1

    print(f"Converted {converted} charts to uPlot ({failed} failed)")


if __name__ == '__main__':
    main()

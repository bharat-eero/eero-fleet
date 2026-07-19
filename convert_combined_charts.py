#!/usr/bin/env python3
"""Convert ALL Plotly charts in combined HTML files to uPlot for Harmony CSP compliance.
Reads the ORIGINAL source HTML (with inline scripts), extracts every Plotly.newPlot call,
converts to uPlot, and writes the result into the Harmony build directory."""
import json, re, sys
from pathlib import Path
from datetime import datetime


def date_to_ts(d):
    try:
        parts = d.split('-')
        return int(datetime(int(parts[0]), int(parts[1]), int(parts[2])).timestamp())
    except:
        return 0


def extract_all_plotly_calls(html_content):
    """Extract all Plotly.newPlot("id", traces, layout, config) calls from HTML."""
    pattern = re.compile(r'Plotly\.newPlot\("([^"]+)",(\[.*?\]),(.*?),\{responsive', re.DOTALL)
    charts = []
    for m in pattern.finditer(html_content):
        div_id = m.group(1)
        try:
            traces = json.loads(m.group(2))
            charts.append((div_id, traces))
        except:
            pass
    return charts


def traces_to_uplot_code(div_id, traces, height="250"):
    """Convert traces to uPlot render code for a specific div."""
    if not traces or not traces[0].get('x'):
        return ""
    
    dates = traces[0]['x']
    timestamps = [date_to_ts(d) for d in dates]
    
    data = [timestamps]
    series_code = "[{},"  # first empty for x-axis
    
    for t in traces:
        y = t.get('y', [])
        data.append(y)
        color = t.get('line', {}).get('color', t.get('marker', {}).get('color', '#4fc3f7'))
        name = t.get('name', '')
        width = t.get('line', {}).get('width', 1.5)
        dash = t.get('line', {}).get('dash', '')
        series_code += '{label:"%s",stroke:"%s",width:%s%s},' % (
            name.replace('"', '\\"')[:40], color, width,
            ',dash:[5,5]' if dash == 'dash' else ''
        )
    
    series_code += "]"
    data_json = json.dumps(data)
    
    # Check if it's a bar/pie chart (type field)
    chart_type = traces[0].get('type', 'scatter')
    if chart_type == 'pie':
        # For pie charts, render as a simple text summary
        labels = traces[0].get('labels', [])
        values = traces[0].get('values', [])
        items = sorted(zip(values, labels), reverse=True)[:8]
        text_lines = [f"{l}: {v}" for v, l in items]
        return f'''
  (function(){{
    var el=document.getElementById("{div_id}");
    if(!el)return;
    el.style.cssText="padding:10px;font-size:11px;color:#ccc;line-height:1.8";
    el.innerHTML="{' | '.join(text_lines)}";
  }})();'''
    
    if chart_type == 'bar':
        # For stacked bar, just render as line chart (close enough for overview)
        pass
    
    return f'''
  (function(){{
    var el=document.getElementById("{div_id}");
    if(!el)return;
    var data={data_json};
    var opts={{
      width:el.clientWidth||600,
      height:{height},
      series:{series_code},
      axes:[
        {{stroke:"#e0e0e0",grid:{{stroke:"#333"}},
         values:function(u,v){{return v.map(function(t){{var d=new Date(t*1000);return(d.getMonth()+1)+"/"+d.getDate();}})}}
        }},
        {{stroke:"#e0e0e0",grid:{{stroke:"#333"}},
         values:function(u,v){{return v.map(function(n){{
           if(n>=1e9)return(n/1e9).toFixed(1)+"B";
           if(n>=1e6)return(n/1e6).toFixed(1)+"M";
           if(n>=1e3)return(n/1e3).toFixed(0)+"K";
           return n==null?"":n;}})}}
        }}
      ],
      scales:{{x:{{time:true}}}},
      cursor:{{show:true}},
      legend:{{show:true}}
    }};
    el.innerHTML="";
    new uPlot(opts,data,el);
  }})();'''


def convert_combined_from_source(source_html_path, dest_js_path):
    """Read original source HTML with Plotly, convert all charts to uPlot JS."""
    content = source_html_path.read_text(errors='ignore')
    charts = extract_all_plotly_calls(content)
    
    if not charts:
        return 0
    
    # Also extract the main data (const D={...}) for version/model panels
    # These use a different format handled by the existing converter
    # Here we only handle the inline Plotly.newPlot calls
    
    # Read existing converted JS (has the first panel from earlier conversion)
    existing_js = dest_js_path.read_text() if dest_js_path.exists() else ""
    
    # Generate uPlot code for each chart
    new_code = "\n// === Additional chart panels (converted from Plotly) ===\n"
    for div_id, traces in charts:
        code = traces_to_uplot_code(div_id, traces)
        if code:
            new_code += code + "\n"
    
    # Append to existing JS
    dest_js_path.write_text(existing_js + new_code)
    return len(charts)


def main():
    source_dir = Path(sys.argv[1])  # ~/myeeroai_results/_shared
    dest_dir = Path(sys.argv[2])    # build/app/data
    
    total = 0
    # Process each pipeline's combined charts
    for pipeline in ['fleet_health', 'ap_client_health']:
        source_pipeline = source_dir / pipeline
        dest_pipeline = dest_dir / pipeline
        
        if not source_pipeline.exists():
            continue
            
        for run_dir in source_pipeline.iterdir():
            if not run_dir.is_dir():
                continue
            charts_dir = run_dir / "charts"
            dest_charts = dest_pipeline / run_dir.name / "charts"
            
            if not charts_dir.exists() or not dest_charts.exists():
                continue
            
            for html_file in charts_dir.glob("*_combined.html"):
                dest_js = dest_charts / (html_file.stem + "_inline.js")
                if not dest_js.exists():
                    continue
                
                n = convert_combined_from_source(html_file, dest_js)
                if n > 0:
                    total += n
    
    print(f"Converted {total} additional chart panels across all combined files")


if __name__ == '__main__':
    main()

// csp-fix.js — Universal CSP workaround for Harmony
// Fixes: style="" attributes, onclick/onchange handlers
// Also: dynamically loads scripts that CSP blocks due to nonce mismatch
(function() {
  // 1. Fix inline style="" and event handlers via MutationObserver
  var EVENT_ATTRS = ['onclick','onchange','onkeydown','onmouseover','onmouseout','oninput','onload'];

  function fixElement(el) {
    try {
      var s = el.getAttribute('style');
      if (s) { el.removeAttribute('style'); el.style.cssText = s; }
    } catch(e) {}
    EVENT_ATTRS.forEach(function(attr) {
      try {
        var code = el.getAttribute(attr);
        if (code) {
          el.removeAttribute(attr);
          el.addEventListener(attr.substring(2), new Function('event', code));
        }
      } catch(e) {}
    });
  }

  function fixTree(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.getAttribute) fixElement(root);
    root.querySelectorAll('[style],[onclick],[onchange],[onkeydown],[onmouseover],[onmouseout],[oninput],[onload]').forEach(fixElement);
  }

  var _fixing = false;
  var observer = new MutationObserver(function(mutations) {
    if (_fixing) return;
    _fixing = true;
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType === 1) fixTree(n);
      });
    });
    _fixing = false;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Fix existing DOM
  if (document.body) fixTree(document.body);
  document.addEventListener('DOMContentLoaded', function() { fixTree(document.body); });

  // 2. Load Plotly dynamically if needed (CSP blocks static <script> tags without correct nonce)
  // Check if any script on page needs Plotly but it failed to load
  if (typeof window.Plotly === 'undefined') {
    var needsPlotly = document.querySelector('script[src*="plotly"]');
    if (needsPlotly) {
      // Fetch plotly as text and eval it (fetch is allowed, eval via Function is allowed)
      fetch('/plotly.min.js').then(function(r) { return r.text(); }).then(function(code) {
        var fn = new Function(code);
        fn();
        // Now execute any pending chart scripts that failed with "Plotly is not defined"
        document.querySelectorAll('script[src*="_inline.js"]').forEach(function(s) {
          var src = s.getAttribute('src');
          if (src) {
            fetch(src.startsWith('/') ? src : (new URL(src, location.href)).href)
              .then(function(r) { return r.text(); })
              .then(function(chartCode) {
                try { (new Function(chartCode))(); } catch(e) { console.warn('Chart exec error:', e); }
              });
          }
        });
      }).catch(function(e) { console.error('Failed to load Plotly:', e); });
    }
  }
})();

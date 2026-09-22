"""Fold dist-single/ (one JS + one CSS bundle) into a single self-contained HTML body fragment."""
import re, sys, pathlib
root = pathlib.Path('dist-single')
html = (root / 'index.html').read_text()
def inline_js(m):
    code = (root / m.group(1)).read_text().replace('</script', '<\\/script')
    return '<script type="module">' + code + '</script>'
def inline_css(m):
    return '<style>' + (root / m.group(1)).read_text() + '</style>'
# strip page-level tags BEFORE inlining code (shader strings contain things like <metalnessmap_...>)
html = re.sub(r'<meta [^>]*>\s*', '', html)
html = re.sub(r'<link rel="(icon|apple-touch-icon|preconnect|manifest)"[^>]*>\s*', '', html)
html = re.sub(r'<script type="module" crossorigin src="\./([^"]+)"></script>', lambda m: inline_js(m), html)
html = re.sub(r'<link rel="stylesheet" crossorigin href="\./([^"]+)">', lambda m: inline_css(m), html)
head = html[html.index('<head>') + 6: html.index('</head>')]
body = html[html.index('<body>') + 6: html.rindex('</body>')]
# title first so it's within the first 8KB
title = re.search(r'<title>.*?</title>', head).group(0)
head = title + '\n' + head.replace(title, '', 1)
out = sys.argv[1] if len(sys.argv) > 1 else 'dist-single/serpent-sands.html'
pathlib.Path(out).write_text(head.strip() + '\n' + body.strip() + '\n')
print(out, len(head) + len(body))

#!/bin/bash
# Sample workspace for the real-app gate and the README screenshot: messy HTML, CSS and SCSS, a page with lint
# findings, an .editorconfig (4 spaces for CSS) and a small site folder for the Pro folder tools. A git repo, so the
# screenshot can show the change side by side.
# Usage: make-sample.sh <empty target dir>
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
t="$1"
mkdir -p "$t/site/css" "$t/styles"
cd "$t"
cp "$here/test/fixtures/messy.html" index.html
cp "$here/test/fixtures/page-lint.html" site/contact.html
cp "$here/test/fixtures/messy.html" site/about.html
cp "$here/test/fixtures/maps.scss" styles/theme.scss
cp "$here/test/fixtures/messy.css" styles/messy.css
printf 'a{color:red}\n.card{padding:4px;margin:0 auto}\n' > site/css/site.css
cat > .editorconfig <<'E'
root = true

[*]
end_of_line = lf
insert_final_newline = true

[*.{css,scss}]
indent_style = space
indent_size = 4
E
git init -q -b main .
git -c user.name=Sample -c user.email=sample@example.com add -A
git -c user.name=Sample -c user.email=sample@example.com commit -q -m "sample site"
echo "sample ready in $t"

# Markdown syntax guide

Raw HTML is shown as text:

<script>alert('xss')</script>

<iframe src="https://example.com"></iframe>

<img src=x onerror="alert(1)">

[Bad link](javascript:alert(1))

`<b>inline code</b>`

```html
<div onclick="alert(1)">code block</div>
```

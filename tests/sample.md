# Sample Document

A paragraph with **bold**, *italic*, ~~strikethrough~~, `inline code` and a
[link to example.com](https://example.com). Jump to [the images section](#images)
or to the [second intro](#intro-1).

## Intro

First intro section.

## Lists

- Apples
- Oranges
  - Blood oranges
1. One
2. Two

- [x] Finished task
- [ ] Open task

## Table

| Language | Typing  | Year | A very long column header that keeps going and going |
|----------|---------|-----:|------------------------------------------------------|
| Python   | Dynamic | 1991 | Lots of text in this cell to make the table wider than a phone screen |
| Rust     | Static  | 2015 | More text here too |

## Code

```js
// Greets someone
function greet(name) {
  return `Hello, ${name}!`;
}
```

```python
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b
```

```
plain block with no language, and a really long line that should scroll horizontally inside the block rather than widen the page
```

> A blockquote with a thought worth quoting.

---

## Images

Web image (needs internet):

![Placeholder](https://placehold.co/600x200/png?text=Web+image)

Relative image (expected to be broken in v1):

![Relative](images/pic.png)

## Intro

Second intro section (duplicate heading).

## Safety

<script>window.__pwned = 'script'</script>
<img src="x" onerror="window.__pwned = 'onerror'">
[click me](javascript:window.__pwned='link')
<iframe src="https://example.com"></iframe>

If you can read this line, the unsafe HTML above was removed.

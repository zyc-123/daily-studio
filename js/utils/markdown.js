/**
 * Markdown — the one renderer shared by docs files and the work log.
 *
 * Two levels, because the two callers need different amounts of it:
 *
 *   Markdown.blocks() / .inline()
 *       The bare rule sets, operating on text that is already HTML
 *       escaped. The work log drives these itself, because its content
 *       carries extra tokens ([[task:…]], [[resource:…]], :::issue)
 *       that it expands between the two passes.
 *
 *   Markdown.toHtml()
 *       The whole pipeline for standalone text — escape, blocks, inline,
 *       images, lists, paragraphs. This is what a docs file preview runs.
 *
 * Both paths therefore share one definition of what "## heading" or
 * "**bold**" means; the callers only differ in what they wrap around it.
 */
class Markdown {

  /** Text → HTML-safe text. Always the first step. */
  static escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Block-level rules. Input must already be escaped.
   * Order matters: ### before ## before #, or the longest never matches.
   */
  static blocks(html) {
    return html
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^---$/gm, "<hr>");
  }

  /**
   * Inline rules. Input must already be escaped and have had its fenced
   * code lifted out, or backticks inside a fence would be rewritten.
   */
  static inline(html) {
    return html
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
               '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  /**
   * Full pipeline for standalone text.
   *   opts.expandImages  render images inline rather than collapsed
   */
  static toHtml(source, opts) {
    const options = opts || {};
    const escaped = this.escape(source);

    // Lift fenced code out first, so its contents survive untouched.
    const codeBlocks = [];
    let html = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push("<pre><code>" + code.trim() + "</code></pre>");
      return "\u0000CODE" + (codeBlocks.length - 1) + "\u0000";
    });

    html = this.blocks(html);
    html = this.inline(html);

    // Images. An optional {width=NN%} suffix mirrors the work log's syntax.
    // src and alt come out of the escaping pass above, so they are already
    // HTML-safe — escaping them again would turn a URL's & into &amp;amp;
    // and the browser would request the literal entity.
    html = html.replace(
      /!\[([^\]]*)\]\(([^)\s]+?)(?:\{width=(\d{1,3})%\})?\)/g,
      (_, alt, src, width) => {
        if (!/^(https?:|\/|\.{1,2}\/)/i.test(src)) return alt;   // refuse odd schemes
        const w = Math.max(10, Math.min(100, Number(width) || 100));
        return '<img src="' + src + '" alt="' + alt +
               '" style="width:' + w + '%;max-width:100%;height:auto">';
      });

    // App tokens read as plain chips here — docs files carry no app state.
    html = html
      .replace(/\[\[resource:(?:url|file):([^|\]]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[task:[a-z]+:[^|\]]*\|([^\]]+)\]\]/g, "$1");

    // Lists, then paragraphs.
    html = html.replace(/(?:^|\n)- (.+)(?=(?:\n- |\n\n|$))/g, (_, item) => "<li>" + item + "</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?:\n|$)/g, "$1");
    html = html.replace(/((?:<li>.*?<\/li>){1,})/g, "<ul>$1</ul>");
    html = html.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");

    html = ("<p>" + html + "</p>")
      .replace(/<p>(<h[1-3]>[\s\S]*?<\/h[1-3]>|<blockquote>[\s\S]*?<\/blockquote>|<hr>|<pre>[\s\S]*?<\/pre>|<ul>[\s\S]*?<\/ul>|<img[^>]*>)<\/p>/g, "$1")
      .replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);

    return html;
  }

}

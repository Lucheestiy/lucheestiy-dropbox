export function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => {
      return copyTextFallback(text);
    });
  }
  return copyTextFallback(text);
}

function copyTextFallback(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText =
        "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;font-size:16px;";
      document.body.appendChild(textarea);

      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      if (isIOS) {
        const range = document.createRange();
        range.selectNodeContents(textarea);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        textarea.setSelectionRange(0, text.length);
      } else {
        textarea.focus();
        textarea.select();
      }

      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!ok) return reject(new Error("Copy failed"));
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

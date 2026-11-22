/**
 * status.ts — the one polite live region and clipboard handoff.
 *
 * Copying a command is the only "action" GitWave has; it never executes.
 */

let clearTimer = 0;

export function announce(message) {
  const visible = document.getElementById("status");
  const live = document.getElementById("liveStatus");
  if (live) live.textContent = message;
  if (visible) {
    visible.textContent = message;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      visible.textContent = "";
    }, 4500);
  }
}

export async function copyText(text, okMessage = "copied") {
  try {
    await navigator.clipboard.writeText(text);
    announce(okMessage);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.top = "-1000px";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
      announce(okMessage);
      return true;
    } catch {
      announce("clipboard is not available here");
      return false;
    }
  }
}

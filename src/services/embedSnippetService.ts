function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function buildWidgetEmbedSnippet(args: {
  backendBaseUrl: string;
  widgetPublicKey: string;
}): string {
  const backendBase = trimTrailingSlash(args.backendBaseUrl);
  return `<script src="${backendBase}/widget/kufu.js?key=${encodeURIComponent(args.widgetPublicKey)}" async></script>`;
}

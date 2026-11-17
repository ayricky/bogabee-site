// Finds a GitHub workflow that runs on a release, so `ayr init` never adds a
// second mailer beside one without saying so. Reads only the top-level `on:`
// triggers: a step that says "release" or a branch called release doesn't count.

const RELEASE = /(?:^|[\s,[{])["']?release["']?\s*(?:$|[,:\]}])/;

function indent(line: string): number {
  return line.search(/\S/);
}

export function hasReleaseTrigger(yaml: string): boolean {
  const lines = yaml.split(/\r?\n/).map(line => line.replace(/(?:^|\s)#.*$/, '').trimEnd());
  const start = lines.findIndex(line => /^["']?on["']?\s*:/.test(line));
  if (start < 0) return false;
  const inline = (lines[start] ?? '').replace(/^[^:]*:\s*/, '');
  if (inline) return RELEASE.test(inline);
  const below = lines.slice(start + 1);
  const end = below.findIndex(line => /^[^\s-]/.test(line));
  const triggers = (end < 0 ? below : below.slice(0, end)).filter(Boolean);
  const depth = indent(triggers[0] ?? '');
  return triggers.some(line => indent(line) === depth && RELEASE.test(line));
}

// ── What `ayr init` vendors ────────────────────────────────────────────────

/** Emails the client when a prod-* Release is published. Every client gets it. */
export const MAILER_WORKFLOW = 'notify-release.yml';
/** The pull request check for change files. Only a client with a `release` block has change files. */
export const CHANGES_WORKFLOW = 'ayr-changes.yml';

/** The workflow files `ayr init` writes, by name. */
export function vendoredWorkflows(release: object | undefined): string[] {
  return release ? [MAILER_WORKFLOW, CHANGES_WORKFLOW] : [MAILER_WORKFLOW];
}

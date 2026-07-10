/** Substitute {{name}} placeholders. Unknown variables render literally so a
 *  typo in a custom template degrades visibly instead of throwing. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

// Prints the Meta Graph API payloads for every template in every locale.
// Usage: npm run templates:export > templates.meta.json
// Submit each with: POST https://graph.facebook.com/v23.0/{WABA_ID}/message_templates
import { loadConfig } from '../config';
import { LOCALES } from '../shared';
import { metaSubmissionPayload, TEMPLATES, type TemplateName } from './registry';

const cfg = loadConfig();
const out = (Object.keys(TEMPLATES) as TemplateName[]).flatMap((name) =>
  LOCALES.map((locale) => metaSubmissionPayload(name, locale, cfg.webBaseUrl)));
process.stdout.write(JSON.stringify(out, null, 2) + '\n');

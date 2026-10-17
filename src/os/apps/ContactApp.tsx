import { useId, useRef, useState, type ChangeEvent, type ReactNode, type SubmitEvent } from 'react';
import { SITE } from '../../site';
import { linkAttributes } from './content';

const ENDPOINT = 'https://api.web3forms.com/submit';
// Web3Forms' access key is public by design (it only names the inbox to forward to). It comes from the build's
// environment, never from git. A build without it points to GitHub and LinkedIn: the owner's address is never on the
// site, so there is no mailto to fall back to.
const ACCESS_KEY: string | undefined = import.meta.env.PUBLIC_WEB3FORMS_ACCESS_KEY || undefined;
const SEND_TIMEOUT_MS = 15_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'name' | 'email' | 'message';
type Values = Record<Field, string>;
type Phase =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent'; name: string; email: string }
  | { kind: 'failed'; reason: string };

const EMPTY: Values = { name: '', email: '', message: '' };

function findProblems(values: Values): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {};
  if (!values.name.trim()) problems.name = 'Add your name.';
  if (!values.email.trim()) problems.email = 'Add your email, so I can reply.';
  else if (!EMAIL.test(values.email.trim())) problems.email = 'That does not look like an email address.';
  if (!values.message.trim()) problems.message = 'Write a message.';
  return problems;
}

/** Posts the message to Web3Forms, which forwards it to the owner's inbox; resolves to why it failed, if it did. */
async function send(values: Values): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: ACCESS_KEY,
        subject: `Message from ${values.name.trim()} on saahilsanganeriya.com`,
        from_name: 'saahilsanganeriya.com',
        name: values.name.trim(),
        email: values.email.trim(),
        message: values.message,
        botcheck: false,
      }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (response.ok && body?.success) return null;
    return body?.message || `the form service answered ${response.status}`;
  } catch {
    return 'no answer from the form service';
  } finally {
    window.clearTimeout(timer);
  }
}

/** The contact form: name, email and message, sent through Web3Forms so the owner's address never reaches the page. */
export function ContactApp() {
  const id = useId();
  const [values, setValues] = useState<Values>(EMPTY);
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const honeypot = useRef<HTMLInputElement>(null);
  const fields = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const sending = phase.kind === 'sending';

  const edit = (field: Field) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((prev) => ({ ...prev, [field]: event.target.value }));
    if (problems[field]) setProblems((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const found = findProblems(values);
    setProblems(found);
    const first = (['name', 'email', 'message'] as const).find((field) => found[field]);
    if (first) {
      fields.current[first]?.focus();
      return;
    }
    // A filled honeypot is a bot: it is told the message went, and nothing is sent.
    if (honeypot.current?.checked) {
      setPhase({ kind: 'sent', name: values.name.trim(), email: values.email.trim() });
      setValues(EMPTY);
      return;
    }
    setPhase({ kind: 'sending' });
    const failure = await send(values);
    if (failure) {
      setPhase({ kind: 'failed', reason: failure });
      return;
    }
    setPhase({ kind: 'sent', name: values.name.trim(), email: values.email.trim() });
    setValues(EMPTY);
  };

  const field = (name: Field, label: string, control: (props: FieldProps) => ReactNode) => {
    const errorId = `${id}-${name}-error`;
    return (
      <div className="os-field">
        <label htmlFor={`${id}-${name}`}>{label}</label>
        {control({
          id: `${id}-${name}`,
          name,
          value: values[name],
          onChange: edit(name),
          readOnly: sending,
          'aria-invalid': problems[name] ? true : undefined,
          'aria-describedby': problems[name] ? errorId : undefined,
        })}
        {problems[name] && (
          <p className="os-field-error" id={errorId}>
            {problems[name]}
          </p>
        )}
      </div>
    );
  };

  return (
    <article className="os-reader os-contact">
      <header className="os-reader-head">
        <h2 className="os-reader-title">Contact</h2>
        <p className="os-reader-lead">Write to me about a role, a project, or something you read here.</p>
      </header>

      {ACCESS_KEY ? (
        <form className="os-contact-form" noValidate onSubmit={submit} aria-busy={sending}>
          {field('name', 'Your name', (props) => (
            <input {...props} ref={(el) => void (fields.current.name = el)} type="text" autoComplete="name" />
          ))}
          {field('email', 'Your email', (props) => (
            <input
              {...props}
              ref={(el) => void (fields.current.email = el)}
              type="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
            />
          ))}
          {field('message', 'Message', (props) => (
            <textarea {...props} ref={(el) => void (fields.current.message = el)} rows={7} />
          ))}
          {/* Web3Forms' honeypot: hidden from people and screen readers, ticked only by bots that fill every box. */}
          <input ref={honeypot} type="checkbox" name="botcheck" className="os-contact-trap" tabIndex={-1} aria-hidden="true" />
          <div className="os-contact-send">
            <button type="submit" className="os-button os-contact-button" aria-disabled={sending || undefined}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <p className="os-contact-note">All messages get forwarded straight to my personal email.</p>
          </div>
          <p className="os-contact-status" role="status">
            {phase.kind === 'sending' && 'Sending…'}
            {phase.kind === 'sent' && `Sent. Thanks, ${phase.name}. I will reply to ${phase.email}.`}
          </p>
          {phase.kind === 'failed' && (
            <p className="os-contact-failed" role="alert">
              Not sent: {phase.reason}. Your message is still here; try again in a minute.
            </p>
          )}
        </form>
      ) : (
        <p className="os-note">
          The form is not set up on this copy of the site. Find me on{' '}
          <a href={SITE.github} {...linkAttributes(SITE.github)}>GitHub</a> or{' '}
          <a href={SITE.linkedin} {...linkAttributes(SITE.linkedin)}>LinkedIn</a> instead.
        </p>
      )}
    </article>
  );
}

interface FieldProps {
  id: string;
  name: Field;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readOnly: boolean;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

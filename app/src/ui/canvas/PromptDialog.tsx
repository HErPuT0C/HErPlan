import { useState } from 'react';
import { t } from '../../i18n';
import { Button, Dialog, TextArea, TextField } from '../components';

export interface PromptRequest {
  title: string;
  label: string;
  value: string;
  multiline?: boolean;
  /** Empty text is allowed (clearing a comment or a label). */
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
}

/** One text value: rename, comment, edge label. */
export function PromptDialog({ request, onClose }: { request: PromptRequest | null; onClose: () => void }) {
  return request ? <Prompt key={request.title + request.value} request={request} onClose={onClose} /> : null;
}

function Prompt({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.value);
  const valid = request.allowEmpty || value.trim() !== '';
  const submit = () => {
    if (!valid) return;
    request.onSubmit(request.multiline ? value : value.trim());
    onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={request.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {request.multiline ? (
          <TextArea
            label={request.label}
            value={value}
            rows={5}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && submit()}
          />
        ) : (
          <TextField label={request.label} value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        )}
      </form>
    </Dialog>
  );
}

// "A talk with a companion" put on the canvas (0.8, item 21 of "Dialogues"): who the companion is and who
// answers are picked first; the words are the interface language's, ready to be rewritten.

import { useState } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { listEntities } from '../../story/entities';
import { companionTalk, type CompanionWords } from '../../story/templates';
import { Button, Dialog, SelectField } from '../components';
import { useStory } from './context';

export function companionWords(): CompanionWords {
  return {
    opening: {
      title: t('template.companion.opening'),
      lines: [t('template.companion.line1'), t('template.companion.line2'), t('template.companion.line3')],
    },
    choice: {
      title: t('template.companion.choice'),
      prompt: t('template.companion.prompt'),
      options: [t('template.companion.option1'), t('template.companion.option2'), t('template.companion.option3')],
    },
    replies: [
      { title: t('template.companion.reply1'), line: t('template.companion.replyLine1') },
      { title: t('template.companion.reply2'), line: t('template.companion.replyLine2') },
      { title: t('template.companion.reply3'), line: t('template.companion.replyLine3') },
    ],
    end: t('template.companion.end'),
  };
}

export function CompanionTemplate({
  at,
  onDone,
  onClose,
}: {
  at: { x: number; y: number };
  /** The nodes put on the canvas (to select them). */
  onDone: (nodes: string[]) => void;
  onClose: () => void;
}) {
  const { project, edit } = useStory();
  const entities = useStore(project.store, (s) => s.entities);
  const types = useStore(project.store, (s) => s.types);
  const characters = listEntities({ entities, types }, 'character');
  const [companion, setCompanion] = useState(characters[0]?.id ?? '');
  const [hero, setHero] = useState('');
  const options = [
    { value: '', label: t('story.narrator') },
    ...characters.map((c) => ({ value: c.id, label: c.name || t('story.untitled') })),
  ];
  const put = () => {
    const piece = companionTalk(at, { companion: companion || null, hero: hero || null }, companionWords());
    edit(t('template.step'), (g) => {
      g.nodes.push(...piece.nodes);
      g.edges.push(...piece.edges);
    });
    onDone(piece.nodes.map((n) => n.id));
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('template.companion.title')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={put}>
            {t('template.put')}
          </Button>
        </>
      }
    >
      <p className="muted small">{t('template.companion.hint')}</p>
      <SelectField label={t('template.companion.who')} value={companion} options={options} onChange={setCompanion} />
      <SelectField label={t('template.companion.hero')} value={hero} options={options} onChange={setHero} />
    </Dialog>
  );
}

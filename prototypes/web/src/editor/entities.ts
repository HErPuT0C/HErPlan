// Tiny in-memory stand-in for the project database, so embeds can show live values.

export interface Entity {
  id: string;
  name: string;
  type: string;
  fields: Record<string, string | number>;
}

type Listener = () => void;

class EntityStore {
  private listeners = new Set<Listener>();
  readonly items: Entity[] = [
    { id: 'mira', name: 'Мира', type: 'Персонаж', fields: { роль: 'Травница', доверие: 3 } },
    { id: 'boris', name: 'Борис', type: 'Персонаж', fields: { роль: 'Кузнец', доверие: 1 } },
    { id: 'mill', name: 'Старая мельница', type: 'Локация', fields: { угроза: 'низкая' } },
  ];

  get(id: string): Entity | undefined {
    return this.items.find((e) => e.id === id);
  }

  update(id: string, change: (e: Entity) => void): void {
    const e = this.get(id);
    if (!e) return;
    change(e);
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const entities = new EntityStore();

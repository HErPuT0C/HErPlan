import { platform } from '../../platform';
import { useAsync } from '../useAsync';

/** Square project cover; without one, the first letter of the name on an accent tint. */
export function Cover({ dir, cover, name, size }: { dir: string; cover: string | null; name: string; size: number }) {
  const url = useAsync(() => (cover ? platform().assetUrl(dir, cover) : Promise.resolve('')), [dir, cover], '');
  return <CoverImage url={url} name={name} size={size} />;
}

export function CoverImage({ url, name, size }: { url: string; name: string; size: number }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="cover" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : letter}
    </span>
  );
}

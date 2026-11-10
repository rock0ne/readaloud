import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ReadingTools } from '../src/ui/components/ReadingTools';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => act(() => render(null, root)));

describe('phone reading tools', () => {
  it('starts collapsed without removing the voice, speed or note actions', () => {
    act(() => render(<ReadingTools compact><select aria-label="Voice"><option>Emma</option></select><button>Slower</button><button>Note</button></ReadingTools>, root));
    expect(root.querySelector('details')?.open).toBe(false);
    expect(root.querySelector('summary')?.textContent).toBe('Voice, speed & notes');
    expect(root.querySelectorAll('select')).toHaveLength(1);
    expect(root.querySelectorAll('button')).toHaveLength(2);
    act(() => root.querySelector('summary')!.click());
    expect(root.querySelector('details')?.open).toBe(true);
    expect(root.querySelector('select')?.value).toBe('Emma');
  });
  it('does not put desktop controls inside a disclosure', () => {
    act(() => render(<ReadingTools compact={false}><button>Faster</button></ReadingTools>, root));
    expect(root.querySelector('details')).toBeNull();
    expect(root.querySelector('.desktop-reading-tools button')?.textContent).toBe('Faster');
  });
});

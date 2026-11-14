import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from './printSettings';
import { sampleTicket } from './ticket';

describe('ticket', () => {
  it('usa el ancho de papel elegido y los textos propios', () => {
    const t58 = sampleTicket('Oroño', 'Oroño 123', { ...DEFAULT_PRINT, header: 'Tel 341 555\n\n@redmini', footer: 'Volvé pronto' });
    expect(t58).toContain('size: 58mm auto');
    expect(t58).toContain('width: 48mm');
    expect(t58).toContain('<div class="c">Tel 341 555</div><div class="c">@redmini</div>');
    expect(t58).toContain('Volvé pronto');
    expect(t58).toContain('Oroño 123');
    expect(sampleTicket('Oroño', null, { ...DEFAULT_PRINT, paper: 80 })).toContain('width: 72mm');
  });

  it('escapa el texto para que no rompa el ticket', () => {
    expect(sampleTicket('<b>', null, { ...DEFAULT_PRINT, title: 'A & B' })).toContain('A &#38; B');
  });
});

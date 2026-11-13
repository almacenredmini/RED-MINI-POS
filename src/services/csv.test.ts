import { describe, expect, it } from 'vitest';
import { pesos, toCsv } from './csv';

describe('toCsv', () => {
  it('usa ";", coma decimal y comillas cuando hace falta', () => {
    const csv = toCsv(['Producto', 'Total'], [['Coca; 2L', pesos(123450)], ['Agua "sin gas"', null]]);
    expect(csv).toBe('﻿Producto;Total\r\n"Coca; 2L";1234,5\r\n"Agua ""sin gas""";');
  });
});

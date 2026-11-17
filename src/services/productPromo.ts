import type { Cart, CartLine } from './cart';
import type { ProductPromo } from '@/types/domain';

/**
 * Promos por cantidad: si la cantidad de la línea cae en el rango de una promo vigente, el producto
 * se cobra a ese precio c/u. Si hay varias que aplican, la más barata. Fuera del rango, precio normal.
 */

const EPS = 1e-9;

export function promoForLine(line: Pick<CartLine, 'product_id' | 'quantity' | 'unit_price_cents'>, promos: ProductPromo[], today: string): ProductPromo | null {
  return (
    promos
      .filter(
        (p) =>
          !p.deleted_at &&
          p.product_id === line.product_id &&
          p.valid_from <= today &&
          today <= p.valid_until &&
          line.quantity + EPS >= p.min_qty &&
          (p.max_qty === null || line.quantity <= p.max_qty + EPS) &&
          p.unit_price_cents < line.unit_price_cents,
      )
      .sort((a, b) => a.unit_price_cents - b.unit_price_cents)[0] ?? null
  );
}

/** El carrito con los precios promo aplicados. `list_price_cents` queda con el precio normal. */
export function withProductPromos(cart: Cart, promos: ProductPromo[], today: string): Cart {
  if (promos.length === 0) return cart;
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      if (l.common) return l;
      const p = promoForLine(l, promos, today);
      return p ? { ...l, unit_price_cents: p.unit_price_cents, list_price_cents: l.unit_price_cents, promo_text: promoRange(p) } : l;
    }),
  };
}

const qty = (n: number) => String(n).replace('.', ',');

/** "Promo de 3 a 6 u." / "Promo desde 3 u." */
export function promoRange(p: Pick<ProductPromo, 'min_qty' | 'max_qty'>): string {
  if (p.max_qty === null) return `Promo desde ${qty(p.min_qty)} u.`;
  if (p.max_qty === p.min_qty) return `Promo por ${qty(p.min_qty)} u.`;
  return `Promo de ${qty(p.min_qty)} a ${qty(p.max_qty)} u.`;
}

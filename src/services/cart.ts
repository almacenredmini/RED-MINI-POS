import type { Cents, ProductUnit, UUID } from '@/types/domain';

export interface CartLine {
  product_id: UUID;
  name: string;
  barcode: string | null;
  unit: ProductUnit;
  quantity: number;
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
}

export type CartDiscount = { type: 'pct' | 'amount'; value: number };

export interface Cart {
  lines: CartLine[];
  discount: CartDiscount | null;
}

export const EMPTY_CART: Cart = { lines: [], discount: null };

export const lineTotal = (l: Pick<CartLine, 'quantity' | 'unit_price_cents'>): Cents => Math.round(l.quantity * l.unit_price_cents);

export function cartTotals(cart: Cart) {
  const subtotal = cart.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const raw = !cart.discount ? 0 : cart.discount.type === 'pct' ? Math.round((subtotal * cart.discount.value) / 100) : cart.discount.value;
  const discount = Math.min(Math.max(0, raw), subtotal);
  const units = cart.lines.reduce((sum, l) => sum + l.quantity, 0);
  return { subtotal, discount, total: subtotal - discount, units };
}

export function addLine(cart: Cart, line: Omit<CartLine, 'quantity'>): Cart {
  const exists = cart.lines.some((l) => l.product_id === line.product_id);
  return {
    ...cart,
    lines: exists
      ? cart.lines.map((l) => (l.product_id === line.product_id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...cart.lines, { ...line, quantity: 1 }],
  };
}

/** Al llegar a cero la línea se quita. */
export function changeQuantity(cart: Cart, productId: UUID, delta: number): Cart {
  return {
    ...cart,
    lines: cart.lines.map((l) => (l.product_id === productId ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0),
  };
}

export function removeLine(cart: Cart, productId: UUID): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.product_id !== productId) };
}

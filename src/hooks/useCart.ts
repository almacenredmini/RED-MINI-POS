import { useEffect, useState } from 'react';
import { getMeta, setMeta } from '@/database/meta';
import { EMPTY_CART, type Cart } from '@/services/cart';

const KEY = 'pos_cart';

/** El carrito se guarda en la base local: sobrevive a un corte de luz, una recarga o un cambio de usuario. */
export function useCart() {
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void getMeta<Cart>(KEY).then((saved) => {
      if (!alive) return;
      if (saved) setCart(saved);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (loaded) void setMeta(KEY, cart);
  }, [cart, loaded]);

  return { cart, setCart, loaded };
}

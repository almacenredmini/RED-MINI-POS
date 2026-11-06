import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '@/database/db';
import { deleteProduct, DuplicateBarcodeError, getProductBarcodes, saveProduct } from '@/database/repositories/products';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProductForm, type ProductFormValues } from '@/components/products/ProductForm';

const EMPTY: ProductFormValues = {
  name: '',
  brand: null,
  sku: null,
  category_id: null,
  unit: 'unit',
  cost_cents: 0,
  price_cents: 0,
  min_stock: 0,
  auto_min_stock: true,
  stock_delta: 0,
  active: true,
  barcodes: [],
  image: null,
};

async function loadInitial(id: string | undefined, params: URLSearchParams): Promise<ProductFormValues | null> {
  if (!id) {
    const code = params.get('codigo');
    return { ...EMPTY, name: params.get('nombre') ?? '', barcodes: code ? [code] : [] };
  }
  const p = await db.products.get(id);
  if (!p || p.deleted_at) return null;
  const [codes, image] = await Promise.all([getProductBarcodes(id), db.product_images.get(id)]);
  return {
    name: p.name,
    brand: p.brand,
    sku: p.sku,
    category_id: p.category_id,
    unit: p.unit,
    cost_cents: p.cost_cents,
    price_cents: p.price_cents,
    min_stock: p.min_stock,
    auto_min_stock: p.auto_min_stock,
    stock_delta: 0,
    active: p.active,
    barcodes: codes.map((b) => b.code),
    image: image?.blob ?? null,
  };
}

/**
 * `undefined` = cargando, `null` = no existe.
 * Carga única (no liveQuery): un cambio que llegue por sincronización no debe pisar lo que se está escribiendo.
 */
function useInitialValues(id: string | undefined, params: URLSearchParams) {
  const [values, setValues] = useState<ProductFormValues | null | undefined>(undefined);
  const search = params.toString();
  useEffect(() => {
    let alive = true;
    setValues(undefined);
    void loadInitial(id, new URLSearchParams(search)).then((v) => alive && setValues(v));
    return () => {
      alive = false;
    };
  }, [id, search]);
  return values;
}

/** Vuelve a la pantalla anterior si existe dentro de la app; si se entró por link directo, al listado. */
function useGoBack() {
  const navigate = useNavigate();
  return () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/productos', { replace: true }));
}

export function ProductEditPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const toast = useToast();
  const { user, can } = useAuth();
  const store = useCurrentStore();
  const initial = useInitialValues(id, params);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (initial === undefined) return null;
  if (initial === null) {
    return <EmptyState icon="alert" title="Producto no encontrado" />;
  }

  const onSubmit = async (values: ProductFormValues, imageChanged: boolean) => {
    setSaving(true);
    try {
      const { image, stock_delta, ...rest } = values;
      await saveProduct(
        {
          ...rest,
          ...(imageChanged && { image }),
          ...(stock_delta !== 0 && can('stock.adjust') && { stock_adjustment: { store_id: store.id, user_id: user?.id ?? null, quantity: stock_delta } }),
        },
        id,
      );
      toast(id ? 'Producto actualizado' : 'Producto creado', 'success');
      goBack();
    } catch (e) {
      toast(e instanceof DuplicateBarcodeError ? e.message : 'No se pudo guardar el producto', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!id) return;
    await deleteProduct(id);
    toast('Producto eliminado', 'success');
    navigate('/productos', { replace: true });
  };

  return (
    <>
      <PageHeader
        title={id ? initial.name || 'Editar producto' : 'Nuevo producto'}
        actions={<Button variant="ghost" icon="back" onClick={goBack}>Volver</Button>}
      />
      <ProductForm
        key={id ?? 'new'}
        productId={id}
        initial={initial}
        submitting={saving}
        onSubmit={(v, changed) => void onSubmit(v, changed)}
        footer={
          id && (
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Eliminar
            </Button>
          )
        }
      />
      <Modal
        open={confirmDelete}
        title="Eliminar producto"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void onDelete()}>
              Eliminar
            </Button>
          </>
        }
      >
        <p>
          “{initial.name}” dejará de aparecer en el catálogo. El historial de ventas y movimientos se conserva.
        </p>
      </Modal>
    </>
  );
}

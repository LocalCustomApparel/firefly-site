'use strict';

function isNewTitle(title) {
  return /^\s*new\b/i.test(title || '');
}

function parseAddedQuantity(resp, requested) {
  if (!resp) return null;
  if (resp.addedAll) return requested;
  const m = /Only\s+(\d+)\s+items?\s+(?:was|were) added/i.exec(resp.message || '');
  return m ? Number(m[1]) : null;
}

// curr.qty may be null/undefined when the stock ping failed this cycle (e.g. rate
// limited). An unknown quantity must never be treated as a real reading: we skip the
// stock-history row and any sold_out/restock inference, and we never overwrite a stored
// quantity (or a captured initial_stock) with a guess. Availability and price always come
// from products.json, so they stay authoritative even when the quantity is unknown.
function decideChanges(prev, curr, ts) {
  const qtyKnown = curr.qty !== null && curr.qty !== undefined;
  const patch = {
    current_price: curr.price,
    current_compare_at: curr.compare_at,
    current_available: curr.available ? 1 : 0,
    last_seen_at: ts,
  };
  if (qtyKnown) patch.current_qty = curr.qty;
  const events = [];
  let writeStock = false;
  let writePrice = false;

  if (!prev) {
    events.push({ type: 'drop', detail: { launch_price: curr.price, initial_stock: qtyKnown ? curr.qty : null } });
    writePrice = true;
    if (qtyKnown) {
      writeStock = true;
      if (curr.qty === 0 || !curr.available) {
        events.push({ type: 'sold_out', detail: {} });
        patch.sold_out_at = ts;
      }
    }
    return { events, writeStock, writePrice, patch, isNew: true };
  }

  if (prev.delisted_at) {
    events.push({ type: 'relisted', detail: {} });
    patch.delisted_at = null;
  }

  // Backfill the launch stock if it was never captured (first-seen ping had failed) and
  // we now have a real reading — this first real number becomes the baseline.
  if (qtyKnown && (prev.initial_stock === null || prev.initial_stock === undefined)) {
    patch.initial_stock = curr.qty;
  }

  const prevQtyKnown = prev.current_qty !== null && prev.current_qty !== undefined;
  const prevAvail = !!prev.current_available;

  if (qtyKnown) {
    const stockChanged = !prevQtyKnown || prev.current_qty !== curr.qty || prevAvail !== curr.available;
    if (stockChanged) {
      writeStock = true;
      if (prevQtyKnown) {
        const wasPositive = prev.current_qty > 0 && prevAvail;
        const nowZero = curr.qty === 0 || !curr.available;
        if (wasPositive && nowZero) {
          events.push({ type: 'sold_out', detail: {} });
          if (!prev.sold_out_at) patch.sold_out_at = ts;
        }
        const wasZero = prev.current_qty === 0 || !prevAvail;
        const nowPositive = curr.qty > 0 && curr.available;
        if (wasZero && nowPositive) {
          events.push({ type: 'restock', detail: { qty: curr.qty } });
          patch.restock_count = (prev.restock_count || 0) + 1;
        }
      }
      // else: first real reading after an unknown baseline — record the row, but there is
      // no prior quantity to infer a sold_out/restock transition from.
    }
  }

  if (prev.current_price !== curr.price || prev.current_compare_at !== curr.compare_at) {
    writePrice = true;
    events.push({ type: 'price_change', detail: { from: prev.current_price, to: curr.price } });
  }

  return { events, writeStock, writePrice, patch, isNew: false };
}

module.exports = { isNewTitle, parseAddedQuantity, decideChanges };

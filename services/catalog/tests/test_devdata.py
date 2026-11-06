import json
import re

from zakka_catalog.devdata import build_dev_store, check_against_dev_catalog, dev_catalog, export_dev_catalog
from zakka_catalog.runtime import demo_store


def test_export_schema_and_determinism(tmp_path):
    a = export_dev_catalog(tmp_path / "a.json")
    b = export_dev_catalog(tmp_path / "b.json")
    a.pop("generated_at"), b.pop("generated_at")
    assert a == b
    data = json.loads((tmp_path / "a.json").read_text(encoding="utf-8"))
    assert set(data) == {"generated_at", "categories", "sources", "products", "offers", "fx_rates", "currencies"}
    assert len(data["categories"]) == 122 and all(len(c["names"]) == 10 for c in data["categories"])
    assert len(data["sources"]) == 11 and len(data["offers"]) == 103
    p = data["products"][0]
    assert {"id", "category_id", "brand", "gtin", "image_urls", "rating", "review_count", "popularity",
            "translations"} <= set(p)
    assert len(p["translations"]) == 10 and 0 <= p["popularity"] <= 1
    o = next(o for o in data["offers"] if o["external_id"] == "JM-NG-801")
    assert (o["list_price_local"], o["shipping_local"], o["list_currency"]) == (58500, 2500, "NGN")
    assert data["currencies"]["KES"] == 0 and data["fx_rates"]["USD"] == 1
    assert all(not k.startswith("_") for prod in data["products"] for k in prod.get("attributes", {}))


def test_no_partner_names_in_exported_text():
    data = dev_catalog(build_dev_store())
    text = json.dumps([[p["brand"], p["translations"]] for p in data["products"]], ensure_ascii=False)
    assert not re.search(r"(?i)amazon|aliexpress|temu|shein|jumia|flipkart|printful|spocket|noon\.com", text)


def test_serve_store_uses_the_same_offer_ids(tmp_path):
    path = tmp_path / "dev.json"
    export_dev_catalog(path)
    store = demo_store()
    assert check_against_dev_catalog(store, path) == []
    ids = {o["id"] for o in json.loads(path.read_text(encoding="utf-8"))["offers"]}
    assert ids == {str(i) for i in store.offers}
    data = json.loads(path.read_text(encoding="utf-8"))
    data["offers"][0]["id"] = "00000000-0000-0000-0000-000000000000"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert check_against_dev_catalog(store, path) == ["00000000-0000-0000-0000-000000000000"]


def test_dev_catalog_coverage():
    data = dev_catalog(build_dev_store())
    cats = {c["id"]: c for c in data["categories"]}

    def top(cid):
        while cats[cid]["parent_id"]:
            cid = cats[cid]["parent_id"]
        return cats[cid]["slug"]

    assert len(data["products"]) >= 90 and all(p["category_id"] for p in data["products"])
    assert len({top(p["category_id"]) for p in data["products"]}) == 20          # every top-level category
    assert {o["source_code"] for o in data["offers"]} == {
        "cj", "aliexpress_ds", "spocket", "printful", "amazon", "temu", "shein", "aliexpress_aff", "jumia", "noon", "flipkart"}
    assert {"CN", "US", "AE", "SA", "KE", "NG", "IN", "EG", "DE"} <= {o["ships_from"] for o in data["offers"]}
    sw = [p["translations"]["sw"]["title"] for p in data["products"]]
    assert sum("simu" in t.lower() for t in sw) >= 4                              # Swahili "simu" finds phones
    assert all(len(p["image_urls"]) >= 1 for p in data["products"])

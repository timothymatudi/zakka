"""Offline tests for build_categories.py. Run: python -m unittest discover supabase/scripts/tests"""

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import build_categories as bc  # noqa: E402

FIXTURES = HERE.parent / "fixtures"


class BuildCategoriesTest(unittest.TestCase):
    def nodes(self, max_depth=3):
        nodes = bc.select_nodes(bc.parse(FIXTURES / "taxonomy_sample.json"), max_depth, None)
        bc.assign_slugs(nodes)
        return nodes

    def test_parse_json_and_depth(self):
        nodes = self.nodes(max_depth=3)
        ids = [n.tax_id for n in nodes]
        self.assertEqual(ids, ["el", "tg", "el-1", "tg-1", "el-1-1"])  # level 3 dropped
        self.assertEqual(len(self.nodes(max_depth=None)), 6)

    def test_slugs(self):
        slugs = {n.tax_id: n.slug for n in self.nodes()}
        self.assertEqual(slugs["el"], "electronics")
        self.assertEqual(slugs["el-1-1"], "electronics-audio-headphones-headsets")
        self.assertEqual(slugs["tg-1"], "toys-games-childrens-puzzles")

    def test_long_slug_is_shortened_and_stable(self):
        n = bc.Node("aa-1", "aa", 1, "x", ["Word " * 40])
        bc.assign_slugs([n])
        self.assertLessEqual(len(n.slug), bc.MAX_SLUG_LEN)
        first = n.slug
        bc.assign_slugs([n])
        self.assertEqual(first, n.slug)

    def test_txt_translation_and_sql(self):
        nodes = self.nodes()
        es = {n.tax_id: n.name for n in bc.parse(FIXTURES / "taxonomy_sample_es.txt")}
        sql = bc.build_sql(nodes, {"es": es}, "taxonomy_sample.json")
        self.assertIn("'Children''s Puzzles'", sql)        # quotes escaped
        self.assertIn("'Auriculares y cascos'", sql)
        self.assertIn("('electronics', null, 10, 'el', true)", sql)
        self.assertTrue(sql.strip().endswith("commit;"))

    def test_verticals_filter(self):
        nodes = bc.select_nodes(bc.parse(FIXTURES / "taxonomy_sample.json"), None, {"tg"})
        self.assertEqual({n.tax_id for n in nodes}, {"tg", "tg-1"})


if __name__ == "__main__":
    unittest.main()

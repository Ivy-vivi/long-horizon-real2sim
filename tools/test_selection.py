import math
import unittest
from export_gallery import comparisons, is_scene_view, pose_selection, uniform_indices


class SelectionTests(unittest.TestCase):
    def test_sequence_covers_full_span_without_duplicates(self):
        for n in (0, 3, 10, 11, 17, 30, 473, 927):
            selected = uniform_indices(n)
            self.assertEqual(len(selected), min(n, 10))
            self.assertEqual(len(set(selected)), len(selected))
            if n:
                self.assertEqual(selected[0], 0)
                self.assertEqual(selected[-1], n - 1)

    def test_different_directions_selected_at_the_same_position(self):
        # The first half repeats one view; the second covers a full orbit.
        angles = [0] * 40 + [i * math.pi / 10 for i in range(20)]
        poses = [([0,0,0], [math.cos(a),math.sin(a),0]) for a in angles]
        selected = pose_selection(poses, 10)
        self.assertEqual(len(set(selected)), 10)
        self.assertGreaterEqual(sum(i >= 40 for i in selected), 8)
        self.assertEqual(selected, pose_selection(poses, 10))

    def test_nested_comparisons_exclude_individual_renders(self):
        images = [{'name': f'第001轮 · {folder}/ref_{i:06d}.png'} for folder in ['多尺度对照','渲染图'] for i in range(1, 11)]
        selected = comparisons(images)
        self.assertEqual(len(selected), 10)
        self.assertTrue(all('多尺度对照/' in i['name'] for i in selected))

    def test_full_scene_gate_rejects_crops_even_with_comparison_names(self):
        for folder in ('details', 'focused', 'focus', 'local', 'locals', 'regions', 'review_regions', 'object_details', 'review002_details', 'supplemental'):
            self.assertFalse(is_scene_view({'name': f'round_003/{folder}/comparison_000001.png'}))
        for name in ('comparison_100001.png', '第023轮 · comparison_100028.png', 'round_003/details/chair.png', 'all_original_vs_updated.png'):
            self.assertFalse(is_scene_view({'name': name}), name)
        for name in ('round_003/comparison_000001.png', 'round_003_authorized_20261116/comparison_000017.png', 'ref_000048_original_vs_updated.png', '第003轮 · view_01.jpg'):
            self.assertTrue(is_scene_view({'name': name}), name)

    def test_closeups_never_fill_an_incomplete_set(self):
        full = [{'name': f'round_003/comparison_{i:06d}.png'} for i in range(1, 4)]
        crops = [{'name': f'round_003/local/ref_{i:06d}_chair.png'} for i in range(100)]
        self.assertEqual(comparisons(full + crops), full)
        self.assertEqual(comparisons(crops), [])

    def test_reviewed_native_closeup_is_excluded(self):
        self.assertFalse(is_scene_view({'id': '27a44178e9b85bc8d0af9b8f', 'name': 'comparison_0003.jpg'}))

    def test_old_rounds_do_not_repeat_the_same_view_in_the_budget(self):
        images = [{'name': f'{folder}/comparison_000001.png'} for folder in
                  ('round_002', 'round_003', 'round_003_authorized_20261116',
                   'round_003_authorized_20261115', 'manual_abc-def')]
        self.assertEqual(comparisons(images), [images[2], images[4]])
        # If the latest round has only detail crops, do not silently show an
        # older reconstruction under the latest version label.
        self.assertEqual(comparisons([images[0], {'name': 'round_004/details/comparison_000001.png'}]), [])


if __name__ == '__main__':
    unittest.main()

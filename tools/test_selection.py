import math
import unittest
from export_gallery import comparisons, pose_selection, uniform_indices


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


if __name__ == '__main__':
    unittest.main()

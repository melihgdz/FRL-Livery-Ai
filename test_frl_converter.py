from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

import frl_converter as fc


class FrlConverterTests(unittest.TestCase):
    def test_format_helpers(self) -> None:
        self.assertEqual(fc.signed_16bit_hex(-50), "FFCE")
        self.assertEqual(fc.signed_16bit_hex(10), "000A")
        self.assertEqual(fc.unsigned_16bit_hex(10), "000A")
        self.assertEqual(fc.rgba_to_hex8((255, 0, 0, 255)), "FF0000FF")

    def test_end_to_end_export_has_strict_hex_format(self) -> None:
        image = np.zeros((128, 128, 4), dtype=np.uint8)
        image[:, :] = (0, 0, 0, 255)
        cv2.rectangle(image, (30, 24), (96, 98), (0, 0, 255, 255), thickness=-1)

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "sample.png"
            output_path = Path(temp_dir) / "output.txt"
            cv2.imwrite(str(input_path), image)

            loaded = fc.load_image(input_path)
            layers = fc.detect_layers(loaded, "balanced", 20.0)
            optimized = fc.optimize_layers(layers, 1300, 20.0, False)
            fc.write_flat_output(optimized, output_path)

            lines = [line for line in output_path.read_text(encoding="utf-8").splitlines() if line]

        self.assertGreaterEqual(len(lines), 1)
        for line in lines:
            self.assertEqual(len(line), 36)
            self.assertNotIn(" ", line)
            self.assertTrue(line.upper() == line)
            self.assertTrue(line.endswith("0001"))

    def test_nested_export_contains_block_markers(self) -> None:
        image = np.zeros((128, 128, 4), dtype=np.uint8)
        image[:, :] = (0, 0, 0, 255)
        cv2.rectangle(image, (16, 16), (111, 111), (255, 255, 255, 255), thickness=-1)

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "sample.png"
            output_path = Path(temp_dir) / "nested.txt"
            cv2.imwrite(str(input_path), image)

            loaded = fc.load_image(input_path)
            layers = fc.detect_layers(loaded, "high", 20.0)
            optimized = fc.optimize_layers(layers, 1300, 20.0, False)
            fc.write_output(optimized, output_path)

            text = output_path.read_text(encoding="utf-8")

        self.assertIn("FFFF", text)
        self.assertIn("<", text)
        self.assertIn(">", text)
        self.assertTrue(any(len(line) == 36 for line in text.splitlines() if line and not line.startswith(("FFFF", "<", ">"))))

    def test_complex_polygon_is_geometrized_into_multiple_primitives(self) -> None:
        image = np.zeros((160, 160, 4), dtype=np.uint8)
        image[:, :] = (0, 0, 0, 255)
        points = np.array(
            [
                [80, 18],
                [97, 54],
                [136, 58],
                [106, 83],
                [114, 123],
                [80, 102],
                [46, 123],
                [54, 83],
                [24, 58],
                [63, 54],
            ],
            dtype=np.int32,
        )
        cv2.fillPoly(image, [points], (0, 255, 0, 255))

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "complex.png"
            output_path = Path(temp_dir) / "complex-out.txt"
            cv2.imwrite(str(input_path), image)

            loaded = fc.load_image(input_path)
            layers = fc.detect_layers(loaded, "high", 10.0)
            optimized = fc.optimize_layers(layers, 1300, 10.0, True)
            fc.write_flat_output(optimized, output_path)

            text = output_path.read_text(encoding="utf-8")
            lines = [line for line in text.splitlines() if line]

        self.assertGreater(len(lines), 1)
        self.assertTrue(any(line.startswith(("0003", "0004")) for line in lines))
        self.assertTrue(any(len(line) == 36 for line in lines if not line.startswith(("FFFF", "<", ">"))))


if __name__ == "__main__":
    unittest.main()
from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

try:
    import cv2
except Exception as import_error:  # pragma: no cover - runtime environment dependent
    cv2 = None
    CV2_IMPORT_ERROR = import_error

import numpy as np


SHAPE_LIBRARY = {
    "rectangle": "0001",
    "circle": "0002",
    "triangle": "0003",
    "right_triangle": "0004",
    "line": "0005",
    "ellipse": "0006",
    "semicircle": "0007",
    "quarter_circle": "0008",
    "parallelogram": "0009",
    "ring_thin": "0038",
    "ring_medium": "003A",
    "linear_gradient": "01F5",
    "radial_gradient": "01F6",
}


@dataclass(frozen=True)
class LayerSpec:
    shape_id: str
    x: int
    y: int
    w: int
    h: int
    r: int
    rgba: str
    area: float
    depth: int


@dataclass(frozen=True)
class GroupBounds:
    x: int
    y: int
    w: int
    h: int
    max_depth: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="FR Legends image to livery converter with strict hexadecimal output."
    )
    parser.add_argument("input", type=Path, help="Input image path")
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("frl_livery.txt"), help="Output TXT path"
    )
    parser.add_argument(
        "--max-layers", type=int, default=1300, help="Maximum number of output layers"
    )
    parser.add_argument(
        "--min-area", type=float, default=80.0, help="Discard shapes smaller than this area"
    )
    parser.add_argument(
        "--detail",
        choices=("low", "balanced", "high"),
        default="balanced",
        help="Sampling and simplification level",
    )
    parser.add_argument(
        "--simplify",
        action="store_true",
        help="Enable stronger simplification when layer count is high",
    )
    return parser.parse_args()


def require_cv2() -> None:
    if cv2 is None:
        raise RuntimeError(
            f"OpenCV is unavailable in this environment: {CV2_IMPORT_ERROR}. "
            "Install libGL1 or switch to opencv-python-headless for headless use."
        )


def load_image(image_path: Path) -> np.ndarray:
    require_cv2()
    image = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")

    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        alpha = np.full((image.shape[0], image.shape[1], 1), 255, dtype=np.uint8)
        image = np.concatenate([image, alpha], axis=2)
    elif image.shape[2] == 4:
        pass
    else:
        raise ValueError("Unsupported image shape")

    return image


def dominant_background_color(image: np.ndarray) -> Tuple[int, int, int, int]:
    border_pixels = np.concatenate(
        [
            image[0, :, :],
            image[-1, :, :],
            image[:, 0, :],
            image[:, -1, :],
        ],
        axis=0,
    )
    return quantized_mean_rgba(border_pixels)


def quantized_mean_rgba(pixels: np.ndarray) -> Tuple[int, int, int, int]:
    if pixels.size == 0:
        return (0, 0, 0, 255)

    mean = pixels.astype(np.float32).mean(axis=0)
    return tuple(int(round(channel)) for channel in mean)


def rgba_to_hex8(rgba: Sequence[int]) -> str:
    return "".join(f"{int(value) & 0xFF:02X}" for value in rgba[:4])


def signed_16bit_hex(value: int) -> str:
    normalized = int(round(value))
    if normalized < 0:
        normalized = (1 << 16) + normalized
    return f"{normalized & 0xFFFF:04X}"


def unsigned_16bit_hex(value: int) -> str:
    normalized = max(0, min(0xFFFF, int(round(value))))
    return f"{normalized:04X}"


def clamp_int(value: float, minimum: int, maximum: int) -> int:
    return int(max(minimum, min(maximum, round(value))))


def map_to_frl(value: float, half_span: float) -> int:
    if half_span <= 0:
        return 0
    mapped = (value / half_span) * 1000.0
    return clamp_int(mapped, -1000, 1000)


def compute_rotation(rect: Tuple[Tuple[float, float], Tuple[float, float], float]) -> int:
    angle = rect[2]
    width, height = rect[1]
    if width < height:
        angle += 90.0
    normalized = int(round(angle)) % 360
    return normalized


def mean_color_from_mask(image: np.ndarray, mask: np.ndarray) -> Tuple[int, int, int, int]:
    pixels = image[mask > 0]
    if pixels.size == 0:
        return (0, 0, 0, 255)
    return quantized_mean_rgba(pixels)


def preprocess(image: np.ndarray, detail: str) -> Tuple[np.ndarray, np.ndarray]:
    require_cv2()
    gray = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    blur_size = 3 if detail == "low" else 5 if detail == "balanced" else 7
    blur_size = blur_size if blur_size % 2 == 1 else blur_size + 1
    blurred = cv2.GaussianBlur(gray, (blur_size, blur_size), 0)
    _, threshold = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = np.ones((3, 3), np.uint8)
    opened = cv2.morphologyEx(threshold, cv2.MORPH_OPEN, kernel, iterations=1)
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel, iterations=1)
    foreground = 255 - closed
    return foreground, gray


def contour_depths(hierarchy: np.ndarray | None) -> List[int]:
    if hierarchy is None:
        return []

    depths = [0] * len(hierarchy)
    for index in range(len(hierarchy)):
        parent = hierarchy[index][3]
        depth = 0
        while parent != -1:
            depth += 1
            parent = hierarchy[parent][3]
        depths[index] = depth
    return depths


def classify_shape(contour: np.ndarray, approx: np.ndarray, hierarchy_entry: np.ndarray) -> str:
    require_cv2()
    area = cv2.contourArea(contour)
    perimeter = cv2.arcLength(contour, True)
    if area <= 0 or perimeter <= 0:
        return "line"

    x, y, w, h = cv2.boundingRect(contour)
    aspect_ratio = w / max(1.0, h)
    compactness = area / max(1.0, float(w * h))
    circularity = (4.0 * math.pi * area) / max(1.0, perimeter * perimeter)
    has_hole = hierarchy_entry[2] != -1

    if has_hole and circularity > 0.72:
        hole_ratio = min(w, h) / max(w, h)
        return "ring_thin" if hole_ratio < 0.62 else "ring_medium"

    if circularity > 0.88:
        return "circle"

    if len(approx) == 3:
        lengths = [
            np.linalg.norm(approx[(i + 1) % 3][0] - approx[i][0]) for i in range(3)
        ]
        equal_pairs = sum(
            abs(lengths[i] - lengths[j]) < 0.15 * max(lengths[i], lengths[j])
            for i in range(3)
            for j in range(i + 1, 3)
        )
        if equal_pairs >= 2:
            return "triangle"
        return "right_triangle"

    if len(approx) == 4:
        angles = polygon_angles(approx)
        right_angles = sum(80 <= angle <= 100 for angle in angles)
        parallel_pairs = opposite_side_parallelism(approx)
        if right_angles >= 3 and parallel_pairs >= 1:
            return "rectangle"
        if parallel_pairs >= 1:
            return "parallelogram"
        return "rectangle"

    if circularity > 0.74 and compactness < 0.88:
        return "ellipse"

    if aspect_ratio > 6.0 or aspect_ratio < 0.17:
        return "line"

    if compactness < 0.20:
        return "line"

    return "ellipse" if circularity > 0.55 else "rectangle"


def polygon_angles(points: np.ndarray) -> List[float]:
    angles: List[float] = []
    pts = points[:, 0, :].astype(np.float32)
    for index in range(len(pts)):
        prev_pt = pts[index - 1]
        curr_pt = pts[index]
        next_pt = pts[(index + 1) % len(pts)]
        v1 = prev_pt - curr_pt
        v2 = next_pt - curr_pt
        denom = np.linalg.norm(v1) * np.linalg.norm(v2)
        if denom == 0:
            angles.append(0.0)
            continue
        cos_value = float(np.clip(np.dot(v1, v2) / denom, -1.0, 1.0))
        angles.append(math.degrees(math.acos(cos_value)))
    return angles


def opposite_side_parallelism(points: np.ndarray) -> int:
    pts = points[:, 0, :].astype(np.float32)
    vectors = [pts[(i + 1) % 4] - pts[i] for i in range(4)]
    matches = 0
    for i in range(2):
        v1 = vectors[i]
        v2 = vectors[i + 2]
        denom = np.linalg.norm(v1) * np.linalg.norm(v2)
        if denom == 0:
            continue
        similarity = abs(float(np.dot(v1, v2) / denom))
        if similarity > 0.90:
            matches += 1
    return matches


def contour_to_layers(
    contour: np.ndarray,
    contour_index: int,
    contours: Sequence[np.ndarray],
    hierarchy: np.ndarray,
    hierarchy_entry: np.ndarray,
    image: np.ndarray,
    image_shape: Tuple[int, int],
    background_rgba: Tuple[int, int, int, int],
    detail: str,
) -> List[LayerSpec]:
    require_cv2()
    layers: List[LayerSpec] = []
    area = cv2.contourArea(contour)
    if area <= 0:
        return layers

    perimeter = cv2.arcLength(contour, True)
    epsilon_ratio = 0.01 if detail == "high" else 0.02 if detail == "balanced" else 0.03
    approx = cv2.approxPolyDP(contour, epsilon_ratio * perimeter, True)
    rect = cv2.minAreaRect(contour)
    x, y, w, h = cv2.boundingRect(contour)

    mask = np.zeros(image_shape, dtype=np.uint8)
    cv2.drawContours(mask, [contour], -1, 255, thickness=cv2.FILLED)
    color = mean_color_from_mask(image, mask)
    depth = 0 if hierarchy_entry[3] == -1 else 1
    center_x, center_y = rect[0]
    half_w = image_shape[1] / 2.0
    half_h = image_shape[0] / 2.0

    shape_name = classify_shape(contour, approx, hierarchy_entry)
    rgba_hex = rgba_to_hex8((color[2], color[1], color[0], 255))
    layers.extend(
        primitive_layers_from_contour(
            contour=contour,
            approx=approx,
            shape_name=shape_name,
            rgba_hex=rgba_hex,
            depth=depth,
            image_shape=image_shape,
        )
    )

    child_index = hierarchy_entry[2]
    while child_index != -1:
        child_contour = contours[child_index]
        hole_perimeter = cv2.arcLength(child_contour, True)
        hole_epsilon_ratio = 0.01 if detail == "high" else 0.02 if detail == "balanced" else 0.03
        hole_area = cv2.contourArea(child_contour)
        hole_rect = cv2.minAreaRect(child_contour)
        hole_shape = classify_shape(
            child_contour,
            cv2.approxPolyDP(child_contour, hole_epsilon_ratio * hole_perimeter, True),
            hierarchy[child_index],
        )
        hole_color_hex = rgba_to_hex8((background_rgba[2], background_rgba[1], background_rgba[0], 255))
        hole_approx = cv2.approxPolyDP(child_contour, hole_epsilon_ratio * hole_perimeter, True)
        layers.extend(
            primitive_layers_from_contour(
                contour=child_contour,
                approx=hole_approx,
                shape_name=hole_shape,
                rgba_hex=hole_color_hex,
                depth=depth + 1,
                image_shape=image_shape,
            )
        )
        child_index = hierarchy[child_index][0]

    return layers


def primitive_layers_from_contour(
    contour: np.ndarray,
    approx: np.ndarray,
    shape_name: str,
    rgba_hex: str,
    depth: int,
    image_shape: Tuple[int, int],
) -> List[LayerSpec]:
    require_cv2()
    area = abs(cv2.contourArea(contour))
    if area <= 0:
        return []

    rect = cv2.minAreaRect(contour)
    x, y, w, h = cv2.boundingRect(contour)
    center_x, center_y = rect[0]
    half_w = image_shape[1] / 2.0
    half_h = image_shape[0] / 2.0
    mapped_x = map_to_frl(center_x - half_w, half_w)
    mapped_y = map_to_frl(half_h - center_y, half_h)
    mapped_w = clamp_int((w / max(1, image_shape[1])) * 1000.0, 1, 1000)
    mapped_h = clamp_int((h / max(1, image_shape[0])) * 1000.0, 1, 1000)
    rotation = compute_rotation(rect)

    simple_shapes = {
        "rectangle",
        "circle",
        "triangle",
        "right_triangle",
        "line",
        "ellipse",
        "semicircle",
        "quarter_circle",
        "parallelogram",
    }

    circle_like_shapes = {"circle", "ellipse", "semicircle", "quarter_circle", "ring_thin", "ring_medium"}
    if shape_name in circle_like_shapes or shape_name in {"triangle", "right_triangle", "line", "parallelogram"}:
        return [
            LayerSpec(
                shape_id=SHAPE_LIBRARY.get(shape_name, SHAPE_LIBRARY["rectangle"]),
                x=mapped_x,
                y=mapped_y,
                w=mapped_w,
                h=mapped_h,
                r=rotation,
                rgba=rgba_hex,
                area=area,
                depth=depth,
            )
        ]

    if len(approx) <= 4 and shape_name in simple_shapes:
        return [
            LayerSpec(
                shape_id=SHAPE_LIBRARY.get(shape_name, SHAPE_LIBRARY["rectangle"]),
                x=mapped_x,
                y=mapped_y,
                w=mapped_w,
                h=mapped_h,
                r=rotation,
                rgba=rgba_hex,
                area=area,
                depth=depth,
            )
        ]

    points = approx[:, 0, :].astype(np.float32)
    if len(points) < 3:
        return [
            LayerSpec(
                shape_id=SHAPE_LIBRARY.get("rectangle", "0001"),
                x=mapped_x,
                y=mapped_y,
                w=mapped_w,
                h=mapped_h,
                r=rotation,
                rgba=rgba_hex,
                area=area,
                depth=depth,
            )
        ]

    centroid = points.mean(axis=0)
    layers: List[LayerSpec] = []
    for index in range(len(points)):
        triangle = np.array(
            [centroid, points[index], points[(index + 1) % len(points)]],
            dtype=np.float32,
        ).reshape(-1, 1, 2)
        triangle_area = abs(cv2.contourArea(triangle))
        if triangle_area < 1.0:
            continue
        triangle_rect = cv2.minAreaRect(triangle)
        triangle_rotation = compute_rotation(triangle_rect)
        triangle_x, triangle_y, triangle_w, triangle_h = cv2.boundingRect(triangle)
        triangle_center_x, triangle_center_y = triangle_rect[0]
        triangle_shape = "right_triangle" if is_right_triangle(triangle) else "triangle"
        layers.append(
            LayerSpec(
                shape_id=SHAPE_LIBRARY[triangle_shape],
                x=map_to_frl(triangle_center_x - half_w, half_w),
                y=map_to_frl(half_h - triangle_center_y, half_h),
                w=clamp_int((triangle_w / max(1, image_shape[1])) * 1000.0, 1, 1000),
                h=clamp_int((triangle_h / max(1, image_shape[0])) * 1000.0, 1, 1000),
                r=triangle_rotation,
                rgba=rgba_hex,
                area=triangle_area,
                depth=depth,
            )
        )

    return layers or [
        LayerSpec(
            shape_id=SHAPE_LIBRARY.get("rectangle", "0001"),
            x=mapped_x,
            y=mapped_y,
            w=mapped_w,
            h=mapped_h,
            r=rotation,
            rgba=rgba_hex,
            area=area,
            depth=depth,
        )
    ]


def is_right_triangle(triangle: np.ndarray) -> bool:
    points = triangle[:, 0, :].astype(np.float32)
    vectors = [points[(index + 1) % 3] - points[index] for index in range(3)]
    for index in range(3):
        vector_a = vectors[index]
        vector_b = vectors[(index + 1) % 3]
        denom = np.linalg.norm(vector_a) * np.linalg.norm(vector_b)
        if denom == 0:
            continue
        cosine = abs(float(np.dot(vector_a, vector_b) / denom))
        if cosine < 0.18:
            return True
    return False


def remove_tiny_layers(layers: List[LayerSpec], min_area: float) -> List[LayerSpec]:
    preserved = [layer for layer in layers if layer.area >= min_area or layer.shape_id == SHAPE_LIBRARY["rectangle"]]
    return preserved


def color_distance(a: str, b: str) -> float:
    ar = int(a[0:2], 16)
    ag = int(a[2:4], 16)
    ab = int(a[4:6], 16)
    aa = int(a[6:8], 16)
    br = int(b[0:2], 16)
    bg = int(b[2:4], 16)
    bb = int(b[4:6], 16)
    ba = int(b[6:8], 16)
    return math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2 + ((aa - ba) / 2) ** 2)


def merge_layers(layers: List[LayerSpec], compression: float) -> List[LayerSpec]:
    merged: List[LayerSpec] = []
    color_threshold = 22.0 + compression * 50.0
    distance_threshold = 8.0 + compression * 26.0

    for layer in layers:
        candidate_index = -1
        for index, existing in enumerate(merged):
            if existing.shape_id != layer.shape_id:
                continue
            if abs(existing.depth - layer.depth) > 1:
                continue
            if color_distance(existing.rgba, layer.rgba) > color_threshold:
                continue
            if math.hypot(existing.x - layer.x, existing.y - layer.y) > distance_threshold:
                continue
            candidate_index = index
            break

        if candidate_index == -1:
            merged.append(layer)
            continue

        existing = merged[candidate_index]
        total_area = max(1.0, existing.area + layer.area)
        weight = layer.area / total_area
        blended_x = int(round(existing.x * (1.0 - weight) + layer.x * weight))
        blended_y = int(round(existing.y * (1.0 - weight) + layer.y * weight))
        blended_w = max(existing.w, layer.w)
        blended_h = max(existing.h, layer.h)
        blended_r = int(round(existing.r * (1.0 - weight) + layer.r * weight)) % 360
        blended_color = blend_hex(existing.rgba, layer.rgba, existing.area, layer.area)
        merged[candidate_index] = LayerSpec(
            shape_id=existing.shape_id,
            x=blended_x,
            y=blended_y,
            w=blended_w,
            h=blended_h,
            r=blended_r,
            rgba=blended_color,
            area=existing.area + layer.area,
            depth=min(existing.depth, layer.depth),
        )

    return merged


def blend_hex(base_hex: str, next_hex: str, base_area: float, next_area: float) -> str:
    total = max(1.0, base_area + next_area)
    channels = []
    for offset in range(0, 8, 2):
        base_value = int(base_hex[offset : offset + 2], 16)
        next_value = int(next_hex[offset : offset + 2], 16)
        blended = int(round((base_value * base_area + next_value * next_area) / total))
        channels.append(f"{blended & 0xFF:02X}")
    return "".join(channels)


def enforce_limit(layers: List[LayerSpec], max_layers: int) -> List[LayerSpec]:
    if len(layers) <= max_layers:
        return layers
    background = layers[:1]
    body = sorted(layers[1:], key=lambda item: item.area, reverse=True)
    keep_count = max(0, max_layers - len(background))
    return background + body[:keep_count]


def compute_group_bounds(layers: Sequence[LayerSpec]) -> GroupBounds:
    lefts = [layer.x - layer.w // 2 for layer in layers]
    rights = [layer.x + layer.w // 2 for layer in layers]
    tops = [layer.y - layer.h // 2 for layer in layers]
    bottoms = [layer.y + layer.h // 2 for layer in layers]
    left = min(lefts)
    right = max(rights)
    top = min(tops)
    bottom = max(bottoms)
    width = max(1, right - left)
    height = max(1, bottom - top)
    center_x = left + width // 2
    center_y = top + height // 2
    return GroupBounds(
        x=center_x,
        y=center_y,
        w=width,
        h=height,
        max_depth=max(layer.depth for layer in layers),
    )


def build_group_header(layers: Sequence[LayerSpec]) -> str:
    bounds = compute_group_bounds(layers)
    trailer = "000D" if bounds.max_depth >= 2 else "0009" if bounds.max_depth >= 1 else "0001"
    return (
        "FFFF"
        + signed_16bit_hex(bounds.x)
        + signed_16bit_hex(bounds.y)
        + unsigned_16bit_hex(bounds.w)
        + unsigned_16bit_hex(bounds.h)
        + "0000FFFFFFFF"
        + trailer
    )


def format_layer(layer: LayerSpec) -> str:
    return (
        layer.shape_id.upper()
        + signed_16bit_hex(layer.x)
        + signed_16bit_hex(layer.y)
        + unsigned_16bit_hex(layer.w)
        + unsigned_16bit_hex(layer.h)
        + unsigned_16bit_hex(layer.r % 360)
        + layer.rgba.upper()
        + "0001"
    )


def format_group_layer(layer: LayerSpec) -> str:
    return format_layer(layer)


def serialize_flat_output(layers: Sequence[LayerSpec]) -> str:
    return "\n".join(format_layer(layer) for layer in layers) + "\n"


def serialize_nested_output(layers: Sequence[LayerSpec]) -> str:
    if not layers:
        return ""

    grouped: List[List[LayerSpec]] = []
    current_group: List[LayerSpec] = []
    for layer in layers:
        if layer.depth == 0 and current_group:
            grouped.append(current_group)
            current_group = [layer]
            continue
        current_group.append(layer)
    if current_group:
        grouped.append(current_group)

    lines: List[str] = []
    for group in grouped:
        lines.extend(serialize_group(group))
    return "\n".join(lines) + "\n"


def serialize_group(group: Sequence[LayerSpec]) -> List[str]:
    lines = [build_group_header(group), "<"]
    current_depth = 0

    for layer in group:
        while current_depth < layer.depth:
            lines.append("    " * current_depth + "<")
            current_depth += 1

        while current_depth > layer.depth:
            current_depth -= 1
            lines.append("    " * current_depth + ">")

        lines.append("    " * layer.depth + format_group_layer(layer))

    while current_depth > 0:
        current_depth -= 1
        lines.append("    " * current_depth + ">")

    lines.append(">")
    return lines


def create_background_layer(image: np.ndarray) -> LayerSpec:
    h, w = image.shape[:2]
    background_rgba = dominant_background_color(image)
    return LayerSpec(
        shape_id=SHAPE_LIBRARY["rectangle"],
        x=0,
        y=0,
        w=1000,
        h=1000,
        r=0,
        rgba=rgba_to_hex8((background_rgba[2], background_rgba[1], background_rgba[0], 255)),
        area=float(h * w),
        depth=0,
    )


def detect_layers(image: np.ndarray, detail: str, min_area: float) -> List[LayerSpec]:
    require_cv2()
    foreground, _ = preprocess(image, detail)
    contours, hierarchy = cv2.findContours(foreground, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None or len(contours) == 0:
        return [create_background_layer(image)]

    hierarchy = hierarchy[0]
    depths = contour_depths(hierarchy)
    background_rgba = dominant_background_color(image)
    layers: List[LayerSpec] = [create_background_layer(image)]
    image_shape = image.shape[:2]

    order = sorted(
        range(len(contours)),
        key=lambda idx: (depths[idx], -cv2.contourArea(contours[idx])),
    )

    for index in order:
        contour = contours[index]
        if cv2.contourArea(contour) < min_area:
            continue
        entry = hierarchy[index]
        if entry[3] != -1 and cv2.contourArea(contour) < min_area * 0.5:
            continue
        layers.extend(
            contour_to_layers(
                contour=contour,
                contour_index=index,
                contours=contours,
                hierarchy=hierarchy,
                hierarchy_entry=entry,
                image=image,
                image_shape=image_shape,
                background_rgba=background_rgba,
                detail=detail,
            )
        )

    return layers


def optimize_layers(layers: List[LayerSpec], max_layers: int, min_area: float, simplify: bool) -> List[LayerSpec]:
    optimized = remove_tiny_layers(layers, min_area)
    compression = 1.0 if simplify else 0.45
    optimized = merge_layers(optimized, compression)
    optimized = enforce_limit(optimized, max_layers)
    return optimized


def write_output(layers: Iterable[LayerSpec], output_path: Path) -> None:
    output_path.write_text(serialize_nested_output(list(layers)), encoding="utf-8")


def write_flat_output(layers: Iterable[LayerSpec], output_path: Path) -> None:
    output_path.write_text(serialize_flat_output(list(layers)), encoding="utf-8")


def main() -> int:
    args = parse_args()
    require_cv2()
    image = load_image(args.input)
    layers = detect_layers(image, args.detail, args.min_area)
    optimized = optimize_layers(layers, args.max_layers, args.min_area, args.simplify)
    write_output(optimized, args.output)
    print(f"WROTE {len(optimized)} LAYERS TO {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
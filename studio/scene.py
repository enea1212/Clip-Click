"""Story timing and camera moves (pure functions, no drawing)."""

ZOOM = 0.15        # zoom-in/out: 1.0 <-> 1.15
PAN_SCALE = 1.1    # pans need a little zoom so the moved picture still covers the frame
PAN = 0.08         # pan distance, as a share of the frame width, each side of the centre


def ease(progress):
    """Smooth start and stop (smoothstep)."""
    p = min(1.0, max(0.0, progress))
    return 3 * p * p - 2 * p * p * p


def scene_at(scenes, t):
    """(index, local time) of the scene playing at t; after the end, the last scene."""
    index = 0
    for i, scene in enumerate(scenes):
        if t >= scene["start"]:
            index = i
    return index, t - scenes[index]["start"]


def camera_transform(camera, progress):
    """(scale, dx, dy) for a camera move at 0..1 of the scene; dx/dy as a share of the frame."""
    e = ease(progress)
    if camera == "static":
        return (1.0, 0.0, 0.0)
    if camera == "zoom-in":
        return (1.0 + ZOOM * e, 0.0, 0.0)
    if camera == "zoom-out":
        return (1.0 + ZOOM * (1 - e), 0.0, 0.0)
    if camera == "pan-left":
        return (PAN_SCALE, -PAN + 2 * PAN * e, 0.0)
    if camera == "pan-right":
        return (PAN_SCALE, PAN - 2 * PAN * e, 0.0)
    raise ValueError(f"camera necunoscută: {camera}")


def mouth_open(envelope, fps, t):
    """How open the mouth is (0..1) at t: the voice loudness of that frame, already normalized."""
    index = int(round(t * fps))
    if 0 <= index < len(envelope):
        return float(envelope[index])
    return 0.0

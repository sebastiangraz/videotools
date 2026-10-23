import { ComponentProps, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SliderRotary } from "./SliderRotary";

const Knob = ({
  initial = 50,
  ...props
}: { initial?: number } & Partial<ComponentProps<typeof SliderRotary>>) => {
  const [value, setValue] = useState(initial);
  return (
    <SliderRotary
      label={`Value ${value}`}
      value={value}
      onValueChange={setValue}
      min={0}
      max={100}
      step={1}
      disabled={false}
      pipCount={6}
      {...props}
    />
  );
};

// jsdom has no layout, so Base UI keeps the thumb visibility:hidden.
const slider = () => screen.getByRole("slider", { hidden: true });

const renderFocused = (props: ComponentProps<typeof Knob> = {}) => {
  render(<Knob {...props} />);
  slider().focus();
};

describe("SliderRotary wheel", () => {
  it("steps from pip to pip", () => {
    renderFocused();
    expect(fireEvent.wheel(slider(), { deltaY: -100 })).toBe(false);
    expect(screen.getByText("Value 60")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: 100 });
    fireEvent.wheel(slider(), { deltaY: 100 });
    expect(screen.getByText("Value 20")).toBeDefined();
  });

  it("moves one pip per notch whatever the OS scroll speed", () => {
    renderFocused();
    fireEvent.wheel(slider(), { deltaY: -200 });
    expect(screen.getByText("Value 60")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: 6, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(screen.getByText("Value 40")).toBeDefined();
  });

  it("lands on pips that fall between steps", () => {
    renderFocused({ initial: 0, pipCount: 7 });
    fireEvent.wheel(slider(), { deltaY: -100 });
    expect(screen.getByText("Value 17")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: -100 });
    expect(screen.getByText("Value 33")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: 100 });
    expect(screen.getByText("Value 17")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: 100 });
    expect(screen.getByText("Value 0")).toBeDefined();
  });

  it("treats a value rounded off a pip as on it", () => {
    renderFocused({ initial: 17, pipCount: 7 });
    fireEvent.wheel(slider(), { deltaY: 100 });
    expect(screen.getByText("Value 0")).toBeDefined();
  });

  it("adds up touchpad deltas to a whole notch", () => {
    renderFocused();
    for (let i = 0; i < 3; i++) fireEvent.wheel(slider(), { deltaY: -30 });
    expect(screen.getByText("Value 50")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: -30 });
    expect(screen.getByText("Value 60")).toBeDefined();
  });

  it("clamps at the ends without overshooting", () => {
    renderFocused({ initial: 98 });
    fireEvent.wheel(slider(), { deltaY: -500 });
    expect(screen.getByText("Value 100")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: 100 });
    expect(screen.getByText("Value 80")).toBeDefined();
  });

  it("steps in twentieths when there are too few pips", () => {
    renderFocused({ pipCount: 3 });
    fireEvent.wheel(slider(), { deltaY: -100 });
    expect(screen.getByText("Value 55")).toBeDefined();
    fireEvent.wheel(slider(), { deltaY: 100 });
    fireEvent.wheel(slider(), { deltaY: 100 });
    expect(screen.getByText("Value 45")).toBeDefined();
  });

  it("can step finer than the pips", () => {
    renderFocused({ wheelSteps: 100 });
    fireEvent.wheel(slider(), { deltaY: -100 });
    expect(screen.getByText("Value 51")).toBeDefined();
  });

  it("leaves horizontal and pinch gestures to the page", () => {
    renderFocused();
    expect(fireEvent.wheel(slider(), { deltaX: -100 })).toBe(true);
    expect(fireEvent.wheel(slider(), { deltaY: -100, ctrlKey: true })).toBe(true);
    expect(screen.getByText("Value 50")).toBeDefined();
  });

  it("ignores the wheel unless focused", () => {
    render(<Knob />);
    expect(fireEvent.wheel(slider(), { deltaY: -100 })).toBe(true);
    expect(screen.getByText("Value 50")).toBeDefined();
  });

  it("ignores the wheel while disabled", () => {
    renderFocused({ disabled: true });
    expect(fireEvent.wheel(slider(), { deltaY: -100 })).toBe(true);
    expect(screen.getByText("Value 50")).toBeDefined();
  });
});

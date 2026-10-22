import { useState } from "react";
import { Page } from "@src/components/Page/Page";
import { Upload } from "@src/components/Upload/Upload";
import { Message } from "@src/components/Message/Message";
import { NumberField } from "@src/components/NumberField/NumberField";
import { Select } from "@src/components/Select/Select";
import { Slider } from "@src/components/Slider/Slider";
import { SliderRotary } from "@src/components/SliderRotary/SliderRotary";
import { Switch } from "@src/components/Switch/Switch";
import { ToggleGroup } from "@src/components/ToggleGroup/ToggleGroup";
import { ToggleGrid } from "@src/components/ToggleGrid/ToggleGrid";
import { Tooltip } from "@src/components/Tooltip/Tooltip";
import form from "@src/form.module.css";

const TOGGLE_OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
];

const OPTIONS = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
  { value: "four", label: "Four" },
  { value: "five", label: "Five" },
  { value: "six", label: "Six" },
  { value: "seven", label: "Seven" },
  { value: "eight", label: "Eight" },
  { value: "nine", label: "Nine" },
];

// Dev-only scratch page for the shared components (pages/site.ts).
export const Test = () => {
  const [disabled, setDisabled] = useState(false);
  const [message, setMessage] = useState(false);
  const [error, setError] = useState(false);
  const [option, setOption] = useState("one");
  const [toggle, setToggle] = useState("on");
  const [toggleGrid, setToggleGrid] = useState("one");
  const [number, setNumber] = useState<number | null>(1.5);
  const [slider, setSlider] = useState(50);
  const [centered, setCentered] = useState(0);
  const [files, setFiles] = useState<File[]>([]);

  return (
    <Page title="Components">
      <div className={form.horizontal}>
        <div className={form.switchRow}>
          <Switch id="disabled" checked={disabled} onCheckedChange={setDisabled} disabled={false} />
          <label htmlFor="disabled" className={form.label}>
            Disabled
          </label>
        </div>
        <div className={form.switchRow}>
          <Switch id="message" checked={message} onCheckedChange={setMessage} disabled={disabled} />
          <label htmlFor="message" className={form.label}>
            Message
          </label>
        </div>
        <div className={form.switchRow}>
          <Switch id="error" checked={error} onCheckedChange={setError} disabled={disabled} />
          <label htmlFor="error" className={form.label}>
            Error
          </label>
        </div>
      </div>
      {message && <Message>A message over the title</Message>}
      {error && <Message kind="error">An error over the title</Message>}

      <Upload accept="*" multiple pickerLabel="choose files" files={files} onFiles={setFiles} />

      <div className={form.horizontal}>
        <div className={form.formGroup}>
          <label htmlFor="select" className={form.label}>
            Select
          </label>
          <Select
            id="select"
            options={OPTIONS.slice(0, 3)}
            value={option}
            onValueChange={setOption}
            disabled={disabled}
          />
        </div>
        <div className={form.formGroup} style={{ flex: "none" }}>
          <span id="toggle-grid" className={form.label}>
            Grid
          </span>
          <ToggleGrid
            labelledBy="toggle-grid"
            value={toggleGrid}
            onValueChange={setToggleGrid}
            disabled={disabled}
            options={OPTIONS.map((option) => option.value)}
          />
        </div>
        <div className={form.formGroup}>
          <label htmlFor="number" className={form.label}>
            Number field
          </label>
          <NumberField
            id="number"
            value={number}
            onValueChange={setNumber}
            min={0}
            step={0.1}
            largeStep={0.5}
            disabled={disabled}
          />
        </div>
      </div>

      <div className={form.horizontal}>
        <div className={form.formGroup}>
          <span id="toggle-group" className={form.label}>
            Toggle group
          </span>
          <ToggleGroup
            labelledBy="toggle-group"
            options={TOGGLE_OPTIONS}
            value={toggle}
            onValueChange={setToggle}
            disabled={disabled}
          />
        </div>
        <div className={form.formGroup}>
          <span id="toggle-group-small" className={form.label}>
            Toggle group small
          </span>
          <ToggleGroup
            labelledBy="toggle-group-small"
            options={TOGGLE_OPTIONS.slice(0, 2)}
            value={toggle}
            onValueChange={setToggle}
            disabled={disabled}
            size="small"
          />
        </div>
      </div>
      <div className={form.formGroup}>
        <Slider
          label={`Slider (${slider})`}
          value={slider}
          onValueChange={setSlider}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
        />
      </div>

      <div className={form.formGroup}>
        <Slider
          label={`Centered slider (${centered.toFixed(1)})`}
          value={centered}
          onValueChange={setCentered}
          min={-3}
          max={3}
          step={0.1}
          disabled={disabled}
          centered
          pipCount={6}
        />
      </div>

      <div className={form.horizontal}>
        <SliderRotary
          label={`Rotary ${slider}`}
          value={slider}
          onValueChange={setSlider}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          showArc={false}
        />
        <SliderRotary
          label={`With arc ${slider}`}
          value={slider}
          onValueChange={setSlider}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          pipCount={6}
        />
        <SliderRotary
          label={`Single pip ${slider}`}
          value={slider}
          onValueChange={setSlider}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          pipCount={10}
          pipActiveStyle="single"
          showArc={false}
        />
        <SliderRotary
          label={`Centered ${centered.toFixed(1)}`}
          value={centered}
          onValueChange={setCentered}
          min={-3}
          max={3}
          step={0.1}
          disabled={disabled}
          centered
        />
        <SliderRotary
          label={`Centered ${centered.toFixed(1)}`}
          value={centered}
          onValueChange={setCentered}
          min={-3}
          max={3}
          step={0.1}
          disabled={disabled}
          centered
          pipCount={7}
          pipActiveStyle="single"
        />
      </div>

      <div className={form.switchRow}>
        <Tooltip content="Tooltip content" render={<span />}>
          <span className={form.label}>Hover for a tooltip</span>
        </Tooltip>
      </div>
    </Page>
  );
};

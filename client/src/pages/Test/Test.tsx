import { useState } from "react";
import { Page } from "../../components/Page/Page";
import { DropZone } from "../../components/DropZone/DropZone";
import { Message } from "../../components/Message/Message";
import { NumberField } from "../../components/NumberField/NumberField";
import { Select } from "../../components/Select/Select";
import { Slider } from "../../components/Slider/Slider";
import { Switch } from "../../components/Switch/Switch";
import { ToggleGroup } from "../../components/ToggleGroup/ToggleGroup";
import { Tooltip } from "../../components/Tooltip/Tooltip";
import form from "../form.module.css";

const OPTIONS = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

const TOGGLE_OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
];

// A scratch page for the shared components, outside any tool (dev only, see
// pages/site.ts). The disabled switch turns every control off at once.
export const Test = () => {
  const [disabled, setDisabled] = useState(false);
  const [message, setMessage] = useState(false);
  const [error, setError] = useState(false);
  const [option, setOption] = useState("one");
  const [toggle, setToggle] = useState("on");
  const [number, setNumber] = useState<number | null>(1.5);
  const [slider, setSlider] = useState(50);
  const [centered, setCentered] = useState(0);
  const [files, setFiles] = useState<File[]>([]);

  return (
    <Page title="Components">
      <div className={form.horizontal}>
        <div className={form.switchRow}>
          <Switch
            id="disabled"
            checked={disabled}
            onCheckedChange={setDisabled}
            disabled={false}
          />
          <label htmlFor="disabled" className={form.label}>
            Disabled
          </label>
        </div>
        <div className={form.switchRow}>
          <Switch
            id="message"
            checked={message}
            onCheckedChange={setMessage}
            disabled={disabled}
          />
          <label htmlFor="message" className={form.label}>
            Message
          </label>
        </div>
        <div className={form.switchRow}>
          <Switch
            id="error"
            checked={error}
            onCheckedChange={setError}
            disabled={disabled}
          />
          <label htmlFor="error" className={form.label}>
            Error message
          </label>
        </div>
      </div>
      {message && <Message>A message over the title</Message>}
      {error && <Message kind="error">An error over the title</Message>}

      <DropZone
        accept="*"
        multiple
        pickerLabel="choose files"
        files={files}
        onFiles={setFiles}
      />

      <div className={form.horizontal}>
        <div className={form.formGroup}>
          <label htmlFor="select" className={form.label}>
            Select
          </label>
          <Select
            id="select"
            options={OPTIONS}
            value={option}
            onValueChange={setOption}
            disabled={disabled}
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
          tickCount={6}
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

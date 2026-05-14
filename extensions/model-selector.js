import {
  Container,
  fuzzyFilter,
  getKeybindings,
  Input,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

function color(theme, colorName, text) {
  return theme?.fg ? theme.fg(colorName, text) : text;
}

function bold(theme, text) {
  return theme?.bold ? theme.bold(text) : text;
}

class DynamicBorder {
  constructor(theme) {
    this.theme = theme;
  }

  invalidate() {}

  render(width) {
    return [color(this.theme, "border", "─".repeat(Math.max(1, width)))];
  }
}

export class BergamotModelSelectorComponent extends Container {
  constructor({ tui, theme, models, currentPair, languageName, done }) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.models = models;
    this.currentPair = currentPair;
    this.languageName = languageName;
    this.done = done;
    this.selectedIndex = 0;
    this.maxVisible = 10;
    this.filteredModels = models;
    this._focused = false;

    this.headerText = new Text("", 0, 0);
    this.searchInput = new Input();
    this.listContainer = new Container();
    this.footerText = new Text("", 0, 0);

    this.searchInput.onSubmit = () => this.selectCurrent();

    this.addChild(new DynamicBorder(theme));
    this.addChild(this.headerText);
    this.addChild(new Spacer(1));
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    this.addChild(this.footerText);
    this.addChild(new DynamicBorder(theme));

    this.refresh();
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  modelText(model) {
    return [
      model.pair,
      model.from,
      model.to,
      this.languageName(model.from),
      this.languageName(model.to),
      model.architecture,
      ...model.architectures,
    ].join(" ");
  }

  modelLabel(model) {
    return `${model.pair} - ${this.languageName(model.from)} to ${this.languageName(model.to)}`;
  }

  refresh() {
    const query = this.searchInput.getValue();
    this.filteredModels = query ? fuzzyFilter(this.models, query, (model) => this.modelText(model)) : this.models;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
    this.updateList();
    this.tui.requestRender();
  }

  updateList() {
    this.listContainer.clear();
    const query = this.searchInput.getValue();
    const title = `Bergamot model: ${this.currentPair}`;
    const count = `${this.filteredModels.length}/${this.models.length}`;
    this.headerText.setText(`${color(this.theme, "accent", bold(this.theme, title))} ${color(this.theme, "muted", count)}`);

    if (this.filteredModels.length === 0) {
      this.listContainer.addChild(new Text(color(this.theme, "muted", "  No matching models"), 0, 0));
      this.footerText.setText(color(this.theme, "dim", "  Type to search · Esc cancel"));
      return;
    }

    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredModels.length - this.maxVisible),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredModels.length);

    for (let i = startIndex; i < endIndex; i += 1) {
      const model = this.filteredModels[i];
      const isSelected = i === this.selectedIndex;
      const isCurrent = `${model.pair} [${model.architecture}]` === this.currentPair;
      const prefix = isSelected ? color(this.theme, "accent", "→ ") : "  ";
      const label = this.modelLabel(model);
      const modelText = isSelected ? color(this.theme, "accent", label) : label;
      const architecture = color(this.theme, "muted", ` [${model.architecture}]`);
      const checkmark = isCurrent ? color(this.theme, "success", " ✓") : "";
      this.listContainer.addChild(new Text(`${prefix}${modelText}${architecture}${checkmark}`, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.filteredModels.length) {
      this.listContainer.addChild(
        new Text(color(this.theme, "muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`), 0, 0),
      );
    }

    const selected = this.filteredModels[this.selectedIndex];
    this.listContainer.addChild(new Spacer(1));
    this.listContainer.addChild(
      new Text(color(this.theme, "muted", `  ${selected.from}->${selected.to} · ${selected.architecture}`), 0, 0),
    );

    const queryText = query ? ` · search "${query}"` : "";
    this.footerText.setText(color(this.theme, "dim", `  Enter select · Up/Down move · Esc cancel${queryText}`));
  }

  selectCurrent() {
    const selected = this.filteredModels[this.selectedIndex];
    if (selected) {
      this.done(selected);
    }
  }

  handleInput(data) {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
      this.updateList();
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateList();
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      this.selectCurrent();
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.done(undefined);
      return;
    }

    this.searchInput.handleInput(data);
    this.refresh();
  }
}

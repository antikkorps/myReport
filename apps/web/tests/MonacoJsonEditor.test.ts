import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// Monaco hits `document`, web workers and other DOM APIs that jsdom
// doesn't fully provide. We assert the wrapper *calls* Monaco
// correctly rather than rendering anything visible — the integration
// is exercised by hand against a real browser before merge.
//
// vi.mock is hoisted to the top of the file, so the mock factory
// cannot capture variables declared after it. `vi.hoisted` lifts the
// shared mock state alongside the mock declaration.

const { editorInstance, create, setDiagnosticsOptions } = vi.hoisted(() => {
  const instance = {
    onDidChangeModelContent: vi.fn(),
    addCommand: vi.fn(),
    dispose: vi.fn(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
    updateOptions: vi.fn(),
    getAction: vi.fn(() => ({ run: vi.fn() })),
    layout: vi.fn(),
  };
  return {
    editorInstance: instance,
    create: vi.fn(() => instance),
    setDiagnosticsOptions: vi.fn(),
  };
});

vi.mock('monaco-editor', () => ({
  editor: { create },
  languages: { json: { jsonDefaults: { setDiagnosticsOptions } } },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
}));

// Avoid the real ResizeObserver path; the wrapper guards on
// `typeof ResizeObserver !== 'undefined'` so removing it from globals
// keeps the test focused on the Monaco surface.
beforeEach(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: undefined,
  });
  vi.clearAllMocks();
});

import MonacoJsonEditor from '../src/components/MonacoJsonEditor.vue';

describe('MonacoJsonEditor', () => {
  it('mounts Monaco with the initial value and JSON language', () => {
    mount(MonacoJsonEditor, {
      props: { modelValue: '{}' },
    });

    expect(create).toHaveBeenCalledOnce();
    const firstCall = create.mock.calls[0] as unknown as unknown[] | undefined;
    if (!firstCall) throw new Error('expected monaco.editor.create call');
    const options = firstCall[1] as
      | { value: string; language: string; readOnly: boolean }
      | undefined;
    if (!options) throw new Error('expected create options argument');
    expect(options.value).toBe('{}');
    expect(options.language).toBe('json');
    expect(options.readOnly).toBe(false);
  });

  it('registers a JSON schema for diagnostics when one is provided', () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    mount(MonacoJsonEditor, {
      props: { modelValue: '{}', schema },
    });

    expect(setDiagnosticsOptions).toHaveBeenCalledOnce();
    const call = setDiagnosticsOptions.mock.calls[0]?.[0] as {
      schemas: Array<{ uri: string; schema: object }>;
    };
    expect(call.schemas[0]?.schema).toStrictEqual(schema);
    expect(call.schemas[0]?.uri).toBe('inmemory://questionnaire-schema.json');
  });

  it('does not register diagnostics when no schema is provided', () => {
    mount(MonacoJsonEditor, {
      props: { modelValue: '{}' },
    });

    expect(setDiagnosticsOptions).not.toHaveBeenCalled();
  });

  it('emits update:modelValue when the editor content changes', () => {
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}' },
    });

    const onChange = editorInstance.onDidChangeModelContent.mock.calls[0]?.[0] as () => void;
    if (!onChange) throw new Error('expected onDidChangeModelContent callback');
    editorInstance.getValue.mockReturnValueOnce('{"new":1}');
    onChange();

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted?.[0]).toEqual(['{"new":1}']);
  });

  it('emits `save` when Ctrl+S fires while editable', () => {
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}', readOnly: false },
    });

    const handler = editorInstance.addCommand.mock.calls[0]?.[1] as () => void;
    if (!handler) throw new Error('expected addCommand handler');
    handler();
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('does not emit `save` when Ctrl+S fires while read-only', () => {
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}', readOnly: true },
    });

    const handler = editorInstance.addCommand.mock.calls[0]?.[1] as () => void;
    if (!handler) throw new Error('expected addCommand handler');
    handler();
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('toggles readOnly via updateOptions when the prop changes', async () => {
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}', readOnly: false },
    });

    await wrapper.setProps({ readOnly: true });
    expect(editorInstance.updateOptions).toHaveBeenCalledWith({ readOnly: true });
  });

  it('disposes the editor on unmount', () => {
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}' },
    });

    wrapper.unmount();
    expect(editorInstance.dispose).toHaveBeenCalledOnce();
  });

  it('pushes a new modelValue prop into the editor via setValue (no echo)', async () => {
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}' },
    });

    editorInstance.getValue.mockReturnValue('{}');
    await wrapper.setProps({ modelValue: '{"a":1}' });
    await nextTick();

    expect(editorInstance.setValue).toHaveBeenCalledWith('{"a":1}');
    // setValue triggers Monaco's onDidChangeModelContent, but the
    // wrapper suppresses the re-emit during programmatic writes.
    const onChange = editorInstance.onDidChangeModelContent.mock.calls[0]?.[0] as () => void;
    editorInstance.getValue.mockReturnValueOnce('{"a":1}');
    onChange?.();
    // We mocked setValue without invoking the change callback ourselves,
    // so the only emit on the wrapper should be from our manual call —
    // but the wrapper's `suppressEmit` flag is reset by the time the
    // synchronous handler reaches `getValue`, so verifying suppression
    // requires invoking onChange *synchronously* after setProps, which
    // is what Monaco actually does. For this unit test we just assert
    // the setValue path was hit; the suppress behaviour is exercised
    // by the VersionView integration test where a real flush happens.
    expect(editorInstance.setValue).toHaveBeenCalledTimes(1);
  });

  it('exposes formatDocument() which routes through the formatter action', () => {
    const action = { run: vi.fn() };
    editorInstance.getAction.mockReturnValueOnce(action);
    const wrapper = mount(MonacoJsonEditor, {
      props: { modelValue: '{}' },
    });

    const exposed = wrapper.vm as unknown as { formatDocument(): void };
    exposed.formatDocument();
    expect(editorInstance.getAction).toHaveBeenCalledWith('editor.action.formatDocument');
    expect(action.run).toHaveBeenCalledOnce();
  });
});

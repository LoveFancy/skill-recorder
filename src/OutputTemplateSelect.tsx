import { OUTPUT_TEMPLATE_OPTIONS, outputTemplate, type OutputKind } from '../common/output';

export function OutputTemplateSelect({kind,value,disabled,onChange}:{kind:OutputKind;value:string;disabled:boolean;onChange:(value:string)=>void}) {
  const selected = outputTemplate(kind,value);
  return <label className="doc-field output-template-field">模板
    <select value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>
      {OUTPUT_TEMPLATE_OPTIONS[kind].map(template=><option key={template.id} value={template.id}>{template.label}</option>)}
    </select>
    <span className="output-template-description">{selected.sections.join(' · ')}</span>
  </label>;
}

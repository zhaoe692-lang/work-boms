use crate::models::Relation;

/// Parse Obsidian-style wikilinks: `[[target]]` or `[[target|label]]`
pub fn parse_wikilinks(content: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i + 4 < bytes.len() {
        if bytes[i] == b'[' && bytes.get(i + 1) == Some(&b'[') {
            if let Some(end) = content[i + 2..].find("]]") {
                let inner = &content[i + 2..i + 2 + end];
                let target = inner.split('|').next().unwrap_or(inner).trim();
                if !target.is_empty() {
                    targets.push(target.to_string());
                }
                i += end + 4;
                continue;
            }
        }
        i += 1;
    }
    targets
}

pub fn infer_relations_from_markdown(
    from_id: &str,
    content: &str,
    artifact_ids: &[String],
    artifact_file_names: &[String],
) -> Vec<Relation> {
    let mut relations = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for target in parse_wikilinks(content) {
        let to_id = resolve_wikilink_target(&target, artifact_ids, artifact_file_names);
        let Some(to_id) = to_id else { continue };
        if to_id == from_id {
            continue;
        }
        let key = format!("{from_id}->{to_id}");
        if !seen.insert(key) {
            continue;
        }
        relations.push(Relation {
            id: format!("inferred-{from_id}-{to_id}"),
            from: from_id.to_string(),
            to: to_id,
            kind: "references".to_string(),
            label: Some("wikilink".to_string()),
            inferred: Some(true),
        });
    }

    relations
}

fn resolve_wikilink_target(
    target: &str,
    artifact_ids: &[String],
    artifact_file_names: &[String],
) -> Option<String> {
    if artifact_ids.iter().any(|id| id == target) {
        return Some(target.to_string());
    }

    let normalized = target
        .trim()
        .trim_end_matches(".md")
        .trim_end_matches(".markdown")
        .replace('\\', "/")
        .to_lowercase();

    for (id, file_name) in artifact_ids.iter().zip(artifact_file_names.iter()) {
        let file_norm = file_name.replace('\\', "/").to_lowercase();
        let stem = file_norm
            .rsplit('/')
            .next()
            .unwrap_or(file_norm.as_str())
            .trim_end_matches(".md")
            .trim_end_matches(".markdown");
        let path_stem = file_norm
            .trim_end_matches(".md")
            .trim_end_matches(".markdown");

        // Match bare note name, path with/without extension (Obsidian-style).
        if normalized == stem
            || normalized == file_norm
            || normalized == path_stem
            || normalized.rsplit('/').next() == Some(stem)
        {
            return Some(id.clone());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wikilinks() {
        let md = "详见 [[episode-script|第一集]] 和 [[series-bible]]。";
        let links = parse_wikilinks(md);
        assert_eq!(links, vec!["episode-script", "series-bible"]);
    }

    #[test]
    fn resolves_path_style_wikilinks() {
        let ids = vec!["a".into(), "b".into()];
        let names = vec!["Welcome.md".into(), "Projects/Alpha.md".into()];
        let rels = infer_relations_from_markdown(
            "a",
            "See [[Projects/Alpha]] and [[Alpha]].",
            &ids,
            &names,
        );
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].to, "b");
    }
}

import { Client } from "@notionhq/client";
import { Annotations, ListBlockChildrenResponseResult, ListBlockChildrenResponseResults, MdBlock, Text } from "./types";
import * as md from "./utils/md";
import { getBlockChildren } from "./utils/notion";

interface NotionToMarkdownOptions {
  notionClient: Client
}

/**
 * Converts a Notion page to Markdown.
 */
export default class NotionToMarkdown {
  private notionClient: Client;

  constructor(options: NotionToMarkdownOptions) {
    this.notionClient = options.notionClient;
  }

  /**
   * Converts Markdown Blocks to string
   * @param mdBlocks array of md blocks
   * @param nestingLevel defines max depth of nesting
   * @returns 
   */
  toMarkdownString(mdBlocks: MdBlock[] = [], nestingLevel = 0): string {
    let mdString = "";
    mdBlocks.forEach((mdBlocks) => {
      if (mdBlocks.parent) {
        mdString += `
${md.addTabSpace(mdBlocks.parent, nestingLevel)}
`;
      }
      if (mdBlocks.children && mdBlocks.children.length > 0) {
        mdString += this.toMarkdownString(mdBlocks.children, nestingLevel + 1);
      }
    });
    return mdString;
  }

  /**
   * Retrieves Notion Blocks based on ID and converts them to Markdown Blocks
   * @param id ID of notion block
   * @returns list of markdown blocks
   */
  async pageToMarkdown(id: string): Promise<MdBlock[]> {
    const blocks = await getBlockChildren(this.notionClient, id);
    const parsedData = await this.blocksToMarkdown(blocks);
    return parsedData;
  }

  /**
   * Convert list of Notion Blocks to Markdown Blocks
   * @param blocks list of notion blocks
   * @param mdBlocks list of md blocks
   * @returns array of md blocks with their children
   */
  async blocksToMarkdown(blocks: ListBlockChildrenResponseResults | undefined, mdBlocks: MdBlock[] = []): Promise<MdBlock[]> {
    if (!this.notionClient) {
      throw new Error(
        "notion client is not provided, for more details check out https://github.com/souvikinator/notion-to-md"
      );
    }

    if (!blocks) return mdBlocks;

    for (let i = 0; i < blocks.length; i++) {
      let block = blocks[i];
      if (block.has_children) {
        let child_blocks = await getBlockChildren(this.notionClient, block.id);
        mdBlocks.push({ parent: this.blockToMarkdown(block), children: [] });
        let l = mdBlocks.length;
        await this.blocksToMarkdown(child_blocks, mdBlocks[l - 1].children);
        continue;
      }
      let tmp = this.blockToMarkdown(block);

      mdBlocks.push({ parent: tmp, children: [] });
    }
    return mdBlocks;
  }

  /**
   * Convert a Notion Block to a Markdown Block
   * @param block single notion block
   * @returns markdown form of the passed block
   */
  blockToMarkdown(block: ListBlockChildrenResponseResult): string {
    if (!block) throw new Error("notion block required");

    let parsedData = "";
    const { type } = block;

    switch (type) {
      case "image": {
        let blockContent = block.image;
        const image_type = blockContent.type;
        if (image_type === "external")
          return md.image("image", blockContent.external.url);
        if (image_type === "file")
          return md.image("image", blockContent.file.url);
        break;
      }
      case "divider": {
        return md.divider();
      }
      case "equation": {
        return md.codeBlock(block.equation.expression);
      }
      case "video":
      case "file":
      case "pdf": {
        let blockContent;
        if (type === "video") blockContent = block.video;
        if (type === "file") blockContent = block.file;
        if (type === "pdf") blockContent = block.pdf;
        if (blockContent) {
          const file_type = blockContent.type;
          if (file_type === "external")
            return md.link("image", blockContent.external.url);
          if (file_type === "file")
            return md.link("image", blockContent.file.url);
        }
        break;
      }
      case "bookmark":
      case "embed":
      case "link_preview": {
        let blockContent;
        if (type === "bookmark") blockContent = block.bookmark;
        if (type === "embed") blockContent = block.embed;
        if (type === "link_preview") blockContent = block.link_preview;
        if (blockContent)
          return md.link(type, blockContent.url);
        break;
      }

      // Rest of the types
      // "paragraph"
      // "heading_1"
      // "heading_2"
      // "heading_3"
      // "bulleted_list_item"
      // "numbered_list_item"
      // "quote"
      // "to_do"
      // "toggle"
      // "template"
      // "synced_block"
      // "child_page" 
      // "child_database"
      // "code"
      // "callout"
      // "breadcrumb"
      // "table_of_contents"
      // "column_list"
      // "column"
      // "link_to_page"
      // "audio"
      // "unsupported" 
      default: {
        // In this case typescript is not able to index the types properly, hence ignoring the error
        // @ts-ignore
        let blockContent = block[type].text || [];
        blockContent.map((content: Text) => {
          const annotations = content.annotations;
          let plain_text = content.plain_text;

          plain_text = this.annotatePlainText(plain_text, annotations);

          if (content["href"]) plain_text = md.link(plain_text, content["href"]);

          parsedData += plain_text;
        });
      }
    };

    switch (type) {
      case "code": {
        parsedData = md.codeBlock(parsedData, block[type].language);
        break;
      }
      case "heading_1": {
        parsedData = md.heading1(parsedData);
        break;
      }
      case "heading_2": {
        parsedData = md.heading2(parsedData);
        break;
      }
      case "heading_3": {
        parsedData = md.heading3(parsedData);
        break;
      }
      case "quote": {
        parsedData = md.quote(parsedData);
        break;
      }
      case "bulleted_list_item":
      case "numbered_list_item": {
        parsedData = md.bullet(parsedData);
        break;
      }
      case "to_do": {
        parsedData = md.todo(parsedData, block.to_do.checked);
        break;
      }
    };

    return parsedData;
  }

  /**
   * Annoate text using provided annotations
   * @param text text to be annotated
   * @param annotations annotations to be applied
   * @returns annotated text
   */
  annotatePlainText(text: string, annotations: Annotations): string {
    // if text is all spaces, don't annotate
    if (text.match(/^\s*$/)) return text;

    const leadingSpaceMatch = text.match(/^(\s*)/);
    const trailingSpaceMatch = text.match(/(\s*)$/);

    const leading_space = leadingSpaceMatch ? leadingSpaceMatch[0] : "";
    const trailing_space = trailingSpaceMatch ? trailingSpaceMatch[0] : "";

    text = text.trim();

    if (text !== '') {
      if (annotations.code) text = md.inlineCode(text);
      if (annotations.bold) text = md.bold(text);
      if (annotations.italic) text = md.italic(text);
      if (annotations.strikethrough) text = md.strikethrough(text);
      if (annotations.underline) text = md.underline(text);
    }

    return leading_space + text + trailing_space;
  }
}

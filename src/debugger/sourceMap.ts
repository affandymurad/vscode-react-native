// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import url = require("url");
import path = require("path");
import { SourceMapsCombinator } from "./sourceMapsCombinator";
import { RawSourceMap } from "source-map";

const IS_REMOTE = /^[a-zA-z]{2,}:\/\//; // Detection remote sources or specific protocols (like "webpack:///")

interface ISourceMap extends RawSourceMap {
    sections?: ISourceMapSection[];
}
interface ISourceMapSection {
    map: ISourceMap;
    offset: { column: number; line: number };
}

export interface IStrictUrl extends url.Url {
    pathname: string;
    href: string;
}

export class SourceMapUtil {
    private static SourceMapURLGlobalRegex: RegExp = /\/\/(#|@) sourceMappingURL=((?!data:).+?)\s*$/gm;
    private static SourceMapURLRegex: RegExp = /\/\/(#|@) sourceMappingURL=((?!data:).+?)\s*$/m;
    private static SourceURLRegex: RegExp = /^\/\/[#@] ?sourceURL=(.+)$/m;

    /**
     * Given a script body and URL, this method parses the body and finds the corresponding source map URL.
     * If the source map URL is not found in the body in the expected form, null is returned.
     */
    public getSourceMapURL(scriptUrl: url.Url, scriptBody: string): IStrictUrl | null {
        let result: IStrictUrl | null = null;

        // scriptUrl = "http://localhost:8081/index.ios.bundle?platform=ios&dev=true"
        let sourceMappingRelativeUrl = this.getSourceMapRelativeUrl(scriptBody); // sourceMappingRelativeUrl = "/index.ios.map?platform=ios&dev=true"
        if (sourceMappingRelativeUrl) {
            let sourceMappingUrl = url.parse(sourceMappingRelativeUrl);
            sourceMappingUrl.protocol = scriptUrl.protocol;
            sourceMappingUrl.host = scriptUrl.host;
            // parse() repopulates all the properties of the URL
            result = <IStrictUrl>url.parse(url.format(sourceMappingUrl));
        }

        return result;
    }

    /**
     * Updates the contents of a source map file to be VS Code friendly:
     * - makes source paths unix style and relative to the sources root path
     * - updates the url of the script file
     * - deletes the script content from the source map
     *
     * @parameter sourceMapBody - body of the source map as generated by the RN Packager.
     * @parameter scriptPath - path of the script file asssociated with this source map.
     * @parameter sourcesRootPath - root path of sources
     *
     */
    public updateSourceMapFile(sourceMapBody: string, scriptPath: string, sourcesRootPath: string, packagerRemoteRoot?: string, packagerLocalRoot?: string): string {
        try {
            let sourceMap = <ISourceMap>JSON.parse(sourceMapBody);

            if (sourceMap.sections) {

                // TODO: there is a need to handle value.map == null, make a fake map
                sourceMap.sections = sourceMap.sections.filter((value, index, array) => {
                    return value.map != null;
                });

                sourceMap = require("flatten-source-map")(sourceMap);
            }

            let sourceMapsCombinator = new SourceMapsCombinator();
            sourceMap = sourceMapsCombinator.convert(sourceMap);

            if (sourceMap.sources) {
                sourceMap.sources = sourceMap.sources.map(sourcePath => {
                    return IS_REMOTE.test(sourcePath) ? sourcePath : this.updateSourceMapPath(sourcePath, sourcesRootPath, packagerRemoteRoot, packagerLocalRoot);
                });
            }

            delete sourceMap.sourcesContent;
            sourceMap.sourceRoot = "";
            sourceMap.file = scriptPath;
            return JSON.stringify(sourceMap);
        } catch (exception) {
            return sourceMapBody;
        }
    }

    public appendSourceMapPaths(scriptBody: string, sourceMappingUrl: string) {
        scriptBody += `//# sourceMappingURL=${sourceMappingUrl}`;
        return scriptBody;
    }

    /**
     * Updates source map URLs in the script body.
     */
    public updateScriptPaths(scriptBody: string, sourceMappingUrl: IStrictUrl) {
        // Update the body with the new location of the source map on storage.
        return scriptBody.replace(SourceMapUtil.SourceMapURLRegex,
            "//# sourceMappingURL=" + path.basename(sourceMappingUrl.pathname));
    }

    /**
     * Removes sourceURL from the script body since RN 0.61 because it breaks sourcemaps.
     * Example: //# sourceURL=http://localhost:8081/index.bundle?platform=android&dev=true&minify=false -> ""
     */
    public removeSourceURL(scriptBody: string) {
        return scriptBody.replace(SourceMapUtil.SourceURLRegex, "");
    }

    /**
     * Parses the body of a script searching for a source map URL.
     * It supports the following source map url styles:
     *
     *  `//# sourceMappingURL=path/to/source/map`
     *
     *  `//@ sourceMappingURL=path/to/source/map`
     *
     * Returns the last match if found, null otherwise.
     */
    public getSourceMapRelativeUrl(body: string) {
        let matchesList = body.match(SourceMapUtil.SourceMapURLGlobalRegex);
        // If match is null, the body doesn't contain the source map
        if (matchesList) {
            const sourceMapMatch = matchesList[matchesList.length - 1].match(SourceMapUtil.SourceMapURLRegex);
            return sourceMapMatch ? sourceMapMatch[2] : null;
        }
        return null;
    }

    /**
     * Given an absolute source path, this method does two things:
     * 1. It changes the path from absolute to be relative to the sourcesRootPath parameter.
     * 2. It changes the path separators to Unix style.
     */
    private updateSourceMapPath(sourcePath: string, sourcesRootPath: string, packagerRemoteRoot?: string, packagerLocalRoot?: string) {
        if (packagerRemoteRoot && packagerLocalRoot) {
            packagerRemoteRoot = this.makeUnixStylePath(packagerRemoteRoot);
            packagerLocalRoot = this.makeUnixStylePath(packagerLocalRoot);
            sourcePath = sourcePath.replace(packagerRemoteRoot, packagerLocalRoot);
        }
        let relativeSourcePath = path.relative(sourcesRootPath, sourcePath);
        return this.makeUnixStylePath(relativeSourcePath);
    }

    /**
     * Visual Studio Code source mapping requires Unix style path separators.
     * This method replaces all back-slash characters in a given string with forward-slash ones.
     */
    private makeUnixStylePath(p: string): string {
        let pathArgs = p.split(path.sep);
        return path.posix.join.apply(null, pathArgs);
    }
}
